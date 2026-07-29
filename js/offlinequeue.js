// Offline-proof logging: a write-through queue for inserts that fail due to a
// genuinely transient (network) problem, so a workout or meal logged with no
// signal is never lost. Queued per-uid in localStorage, mirroring how the
// workout draft (js/fitness.js) is already keyed.
//
// THE LOAD-BEARING DESIGN DECISION: only ever queue a TRANSIENT failure.
// Queueing a PERMANENT one (RLS denial, missing column, a bad constraint)
// would poison the queue forever with a row that can never succeed — and
// worse, block every legitimate write stuck behind it. Supabase surfaces a
// real Postgrest error with a `code` (e.g. '42703', 'PGRST204'); a genuine
// network failure comes back as a bare fetch error with no code at all. So
// the check below is deliberately conservative: anything not confidently a
// network problem surfaces to the user as an error exactly as it does today,
// rather than silently vanishing into the queue.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { toast } from './ui.js';

const flushHandlers = {}; // table -> async fn(payload), run after that row lands

function isTransient(error) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  if (!error) return false;
  if (error.code) return false; // a real Postgrest error — never retry
  return /fetch|network|load failed|timeout/i.test(error.message || '');
}

function queueKey() {
  const uid = getUid();
  return uid ? `offlineQueue:${uid}` : null;
}

function loadQueueRaw() {
  const key = queueKey();
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}
function saveQueueRaw(items) {
  const key = queueKey();
  if (!key) return;
  if (items.length) localStorage.setItem(key, JSON.stringify(items));
  else localStorage.removeItem(key);
}

// Lets a module run follow-up work (e.g. the workout XP/PR pipeline) once its
// queued row actually lands — that work needs the database, so it can't run
// at enqueue time.
export function registerFlushHandler(table, fn) {
  flushHandlers[table] = fn;
}

export function pendingCount() {
  return loadQueueRaw().length;
}

// Attempts the insert immediately. On success: behaves exactly like a plain
// insert. On a transient failure: enqueues and returns { queued: true }
// instead of throwing. On a permanent failure: re-throws, so existing
// try/catch error UI at every call site keeps working unchanged.
export async function queuedInsert(table, payload) {
  const { error } = await sb.from(table).insert(payload);
  if (!error) return { queued: false };
  if (isTransient(error)) {
    const items = loadQueueRaw();
    items.push({ id: crypto.randomUUID(), table, payload, queuedAt: Date.now() });
    saveQueueRaw(items);
    return { queued: true };
  }
  throw error;
}

let flushing = false;
// Replays the queue in order. Stops at the first transient failure (still
// offline — leave the rest for next time). A permanent failure on an
// already-queued item is dropped (never blocks what's behind it) with a
// toast, since retrying it forever could never succeed anyway.
export async function flushQueue() {
  if (flushing) return;
  flushing = true;
  try {
    let items = loadQueueRaw();
    if (!items.length) return;
    let flushedAny = false;
    while (items.length) {
      const item = items[0];
      const { error } = await sb.from(item.table).insert(item.payload);
      if (!error) {
        items.shift();
        saveQueueRaw(items);
        flushedAny = true;
        const handler = flushHandlers[item.table];
        if (handler) { try { await handler(item.payload); } catch { /* best-effort follow-up */ } }
        continue;
      }
      if (isTransient(error)) break; // still failing for network reasons — try the rest later
      items.shift();
      saveQueueRaw(items);
      toast('A queued item could not be saved and was discarded.', 'err');
    }
    if (flushedAny) toast('Synced offline changes', 'ok');
  } finally {
    flushing = false;
  }
}

// Call once at app boot (after session resolves) — mirrors js/theme.js's
// loadAndApplyTheme() being wired into the same session handler.
export function initOfflineQueue() {
  flushQueue();
  window.addEventListener('online', () => flushQueue());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
}
