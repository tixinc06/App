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
  { key: 'streak', label: 'Streak reminders' },
  { key: 'rest', label: 'Rest timer finished' }
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
    // BUG (reported "notifications don't work properly"): a Supabase
    // PostgrestFilterBuilder is thenable (has .then) but does NOT implement
    // .catch — calling .catch() on it directly throws a TypeError, which
    // means this delete ALWAYS failed silently before reaching unsubscribe(),
    // the row was never removed, and the toggle never actually turned off.
    // Plain try/catch around a normal await is the fix (same class of bug
    // that broke the Home dashboard's initial load in Round 6).
    try { await sb.from('push_subscriptions').delete().eq('endpoint', sub.endpoint); } catch { /* best-effort */ }
    try { await sub.unsubscribe(); } catch { /* best-effort */ }
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

// Merges into whatever is already stored rather than blind-replacing the
// whole JSONB blob — `prefs` here only ever carries the NOTIF_TYPES keys this
// module manages, so a plain overwrite would silently erase any other key
// sharing the same notif_prefs column (defensive; nothing else writes into
// it today, but a blind replace on a shared JSONB column is a landmine to
// leave behind).
export async function saveNotifPrefs(prefs) {
  const uid = getUid();
  const { data: existing } = await sb.from('user_settings').select('notif_prefs').eq('user_id', uid).maybeSingle();
  const merged = { ...(existing?.notif_prefs || {}), ...prefs };
  const { error } = await sb.from('user_settings')
    .upsert({ user_id: uid, notif_prefs: merged }, { onConflict: 'user_id' });
  if (error) throw error;
}
