// Web Push: subscribe/unsubscribe this device, and per-type notification
// preferences. The actual sending happens server-side (a Supabase edge
// function triggered by Database Webhooks / pg_cron — see
// migration-round4.sql's "PUSH SETUP" block); this module only manages the
// browser-side subscription and prefs.
//
// Platform note (restate honestly): iOS only supports Web Push on 16.4+, and
// only when the PWA is installed to the home screen. The permission prompt
// must originate from a user gesture (a click), never fired on page load.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { VAPID_PUBLIC } from './config.js';

export const NOTIF_TYPES = [
  { key: 'messages', label: 'New messages' },
  { key: 'friend_requests', label: 'Friend requests' },
  { key: 'streak', label: 'Streak reminders' }
];

export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const base64Safe = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64Safe);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// { supported, permission: 'default'|'granted'|'denied', subscribed }
export async function getPushState() {
  if (!isPushSupported()) return { supported: false, permission: 'denied', subscribed: false };
  const permission = Notification.permission;
  let subscribed = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    subscribed = !!sub;
  } catch { /* SW not ready yet — treat as not subscribed */ }
  return { supported: true, permission, subscribed };
}

// Must be called from a user gesture (a click handler) — the permission
// prompt is blocked by browsers otherwise.
export async function enablePush() {
  if (!isPushSupported()) throw new Error('Push notifications are not supported on this device.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Notification permission was not granted.');

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC)
    });
  }

  const { error } = await sb.from('push_subscriptions')
    .upsert({ user_id: getUid(), endpoint: sub.endpoint, subscription: sub.toJSON() }, { onConflict: 'endpoint' });
  if (error) throw error;
  return sub;
}

export async function disablePush() {
  if (!isPushSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint).catch(() => {});
    await sub.unsubscribe().catch(() => {});
  }
}

export async function loadNotifPrefs() {
  const { data, error } = await sb.from('user_settings').select('notif_prefs').eq('user_id', getUid()).maybeSingle();
  if (error) throw error;
  const prefs = data?.notif_prefs || {};
  const merged = {};
  for (const t of NOTIF_TYPES) merged[t.key] = prefs[t.key] !== false; // default on
  return merged;
}

export async function saveNotifPrefs(prefs) {
  const { error } = await sb.from('user_settings')
    .upsert({ user_id: getUid(), notif_prefs: prefs }, { onConflict: 'user_id' });
  if (error) throw error;
}
