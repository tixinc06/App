// Supabase Edge Function: sends Web Push notifications.
//
// NOT deployed automatically — this file is kept in the repo for version
// control. To use it: Supabase Dashboard -> Edge Functions -> Create a new
// function named "push" -> paste this file's contents -> Deploy. Then set
// the secrets and wire up the triggers described in migration-round4.sql's
// "PUSH SETUP" block.
//
// Invoked by:
//  - a Database Webhook on `messages` INSERT      -> { type:'messages', record }
//  - a Database Webhook on `friendships` INSERT    -> { type:'friend_requests', record }
//  - a daily pg_cron job                           -> { type:'streak' }
// Every call must include header `x-push-secret: <PUSH_HOOK_SECRET>` — this
// is the only thing stopping an arbitrary caller from spamming users.
import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC')!;
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE')!;
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com';
const PUSH_HOOK_SECRET = Deno.env.get('PUSH_HOOK_SECRET')!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

// Service-role client — bypasses RLS. This function runs entirely
// server-side and never exposes this key to any client.
const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

async function notifAllowed(userId: string, type: string): Promise<boolean> {
  const { data } = await sb.from('user_settings').select('notif_prefs').eq('user_id', userId).maybeSingle();
  const prefs = (data?.notif_prefs as Record<string, boolean> | null) || {};
  return prefs[type] !== false; // default on
}

async function sendToUser(userId: string, type: string, title: string, body: string, url = './') {
  if (!(await notifAllowed(userId, type))) return;
  const { data: subs } = await sb.from('push_subscriptions').select('id, subscription').eq('user_id', userId);
  for (const row of subs || []) {
    try {
      await webpush.sendNotification(
        row.subscription,
        JSON.stringify({ title, body, url, tag: type })
      );
    } catch (err) {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) {
        // Subscription is dead (device unregistered / permission revoked) — clean it up.
        await sb.from('push_subscriptions').delete().eq('id', row.id);
      } else {
        console.error('push send failed', status, err);
      }
    }
  }
}

async function handleMessage(record: { sender_id: string; recipient_id: string; body?: string; attachment?: { kind: string } | null }) {
  const { data: sender } = await sb.from('profiles').select('username').eq('user_id', record.sender_id).maybeSingle();
  const preview = record.attachment ? `Shared a ${record.attachment.kind}` : (record.body || '').slice(0, 80);
  await sendToUser(record.recipient_id, 'messages', 'New message', `@${sender?.username || 'someone'}: ${preview}`, './');
}

async function handleFriendRequest(record: { requester_id: string; addressee_id: string; status: string }) {
  if (record.status !== 'pending') return; // only the initial request, not later updates
  const { data: requester } = await sb.from('profiles').select('username').eq('user_id', record.requester_id).maybeSingle();
  await sendToUser(record.addressee_id, 'friend_requests', 'New friend request', `@${requester?.username || 'someone'} wants to connect`, './');
}

// Simple heuristic (not the client's exact Monday-week streak calc): remind
// anyone who trained at least once in the last 7 days but hasn't today.
async function handleStreak() {
  const today = new Date().toISOString().slice(0, 10);
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);

  const { data: subbed } = await sb.from('push_subscriptions').select('user_id');
  const userIds = [...new Set((subbed || []).map(r => r.user_id))];

  for (const uid of userIds) {
    const { data: recent } = await sb.from('workouts').select('workout_date').eq('user_id', uid).gte('workout_date', weekAgo);
    const trainedRecently = (recent || []).length > 0;
    const trainedToday = (recent || []).some(r => r.workout_date === today);
    if (trainedRecently && !trainedToday) {
      await sendToUser(uid, 'streak', 'Keep your streak alive 🔥', "You haven't logged a workout today yet.", './');
    }
  }
}

Deno.serve(async (req) => {
  if (req.headers.get('x-push-secret') !== PUSH_HOOK_SECRET) {
    return new Response('Unauthorized', { status: 401 });
  }

  let payload: { type?: string; record?: Record<string, unknown> } = {};
  try {
    payload = await req.json();
  } catch {
    return new Response('Bad request', { status: 400 });
  }

  try {
    if (payload.type === 'messages' && payload.record) {
      await handleMessage(payload.record as never);
    } else if (payload.type === 'friend_requests' && payload.record) {
      await handleFriendRequest(payload.record as never);
    } else if (payload.type === 'streak') {
      await handleStreak();
    }
    return new Response('ok');
  } catch (err) {
    console.error('push function error', err);
    return new Response('error', { status: 500 });
  }
});
