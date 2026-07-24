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
//  - a pg_cron job every 30 minutes                -> { type:'reminders' }
//  - a pg_cron job every 15 seconds                -> { type:'scheduled' }
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

// `tag` defaults to `type` (unchanged behaviour for every existing caller);
// scheduled pushes pass their own tag ('rest-timer') so a locally-fired
// notification and a late server one collapse into one instead of stacking.
async function sendToUser(userId: string, type: string, title: string, body: string, url = './', tag = type) {
  if (!(await notifAllowed(userId, type))) return;
  const { data: subs } = await sb.from('push_subscriptions').select('id, subscription').eq('user_id', userId);
  for (const row of subs || []) {
    try {
      await webpush.sendNotification(
        row.subscription,
        JSON.stringify({ title, body, url, tag })
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

// Rounds a "HH:MM" string down to its 30-minute slot, so a reminder set for
// e.g. 18:07 matches the 18:00-18:29 cron run and never double-fires within
// the same slot even if the cron invocation runs a little late.
function bucket30(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const roundedMin = (m || 0) < 30 ? '00' : '30';
  return `${String(h || 0).padStart(2, '0')}:${roundedMin}`;
}

// The caller's local wall-clock time + weekday in `tz`, computed via Intl
// (no date-time library needed) — this is what lets a reminder set for
// "18:00" fire at 6pm in the USER's own timezone, not the server's.
function localPartsInZone(tz: string): { hhmm: string; dow: number } {
  const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short'
  });
  const parts = fmt.formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || '';
  let hour = get('hour');
  if (hour === '24') hour = '00'; // some locales render midnight as 24:00
  return { hhmm: `${hour}:${get('minute')}`, dow: WEEKDAY[get('weekday')] ?? new Date().getUTCDay() };
}

type ReminderPrefs = {
  food?: { enabled?: boolean; time?: string };
  workout?: { enabled?: boolean; time?: string };
  weighin?: { enabled?: boolean; time?: string; dow?: number };
};

const REMINDER_COPY: Record<string, [string, string]> = {
  food: ['Log your food 🍽️', "Don't forget to track today's meals."],
  workout: ['Train today 💪', 'Time to get your workout in.'],
  weighin: ['Weigh-in day ⚖️', "Log today's bodyweight."]
};

// For every user with reminder_prefs set, check each enabled reminder type
// against their LOCAL time (from their stored timezone) and fire any whose
// time falls in the current 30-minute cron slot.
async function handleReminders() {
  const { data: rows } = await sb.from('user_settings')
    .select('user_id,reminder_prefs,timezone').not('reminder_prefs', 'is', null);

  for (const row of rows || []) {
    const prefs = (row.reminder_prefs as ReminderPrefs) || {};
    let local: { hhmm: string; dow: number };
    try {
      local = localPartsInZone(row.timezone || 'UTC');
    } catch {
      continue; // unrecognised timezone string — skip rather than guess
    }
    const nowSlot = bucket30(local.hhmm);

    for (const key of ['food', 'workout', 'weighin'] as const) {
      const p = prefs[key];
      if (!p?.enabled || !p?.time) continue;
      if (key === 'weighin' && p.dow != null && Number(p.dow) !== local.dow) continue;
      if (bucket30(p.time) !== nowSlot) continue;
      const [title, body] = REMINDER_COPY[key];
      await sendToUser(row.user_id as string, key, title, body, './');
    }
  }
}

// Sends every due, unsent scheduled_pushes row (currently just the rest
// timer) and stamps sent_at. Rows more than ~2 minutes past their fire_at are
// skipped rather than sent late — a backlog (e.g. the cron job was paused)
// must not ding for a rest that finished long ago; they're still stamped
// sent_at so they don't pile up and get rechecked forever.
async function handleScheduled() {
  const now = Date.now();
  const staleCutoff = new Date(now - 2 * 60 * 1000).toISOString();
  const { data: rows } = await sb.from('scheduled_pushes')
    .select('id,user_id,title,body,tag,fire_at')
    .is('sent_at', null)
    .lte('fire_at', new Date(now).toISOString());
  if (!rows?.length) return;

  for (const row of rows) {
    if (row.fire_at < staleCutoff) {
      await sb.from('scheduled_pushes').update({ sent_at: new Date().toISOString() }).eq('id', row.id);
      continue;
    }
    await sendToUser(row.user_id as string, 'rest', row.title as string, row.body as string, './', (row.tag as string) || 'scheduled');
    await sb.from('scheduled_pushes').update({ sent_at: new Date().toISOString() }).eq('id', row.id);
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
    } else if (payload.type === 'reminders') {
      await handleReminders();
    } else if (payload.type === 'scheduled') {
      await handleScheduled();
    }
    return new Response('ok');
  } catch (err) {
    console.error('push function error', err);
    return new Response('error', { status: 500 });
  }
});
