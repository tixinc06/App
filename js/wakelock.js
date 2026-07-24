// Screen Wake Lock: keeps the display on during a live workout / running rest
// timer, so the phone doesn't sleep mid-set or mid-rest. Best-effort — the
// Wake Lock API (Safari 16.4+, Chrome/Android) simply isn't called at all on
// unsupported browsers, and any failure (e.g. low battery mode) is swallowed.
//
// Two independent callers want this (the open workout-builder modal, and a
// running rest timer that can outlive the modal being closed) — requests are
// tracked by REASON in a Set rather than a single boolean, so one caller
// releasing doesn't drop the lock out from under the other.
//
// The OS auto-releases the lock whenever the page is hidden (tab-switch,
// screen-lock, backgrounding) — without re-acquiring on return, a wake lock
// silently stops working the moment the user glances away and back. The
// visibilitychange listener below re-acquires whenever any reason is still active.
let sentinel = null;
const activeReasons = new Set();

function isSupported() {
  return 'wakeLock' in navigator;
}

async function acquire() {
  if (!isSupported() || sentinel || document.hidden || !activeReasons.size) return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener('release', () => { sentinel = null; });
  } catch {
    sentinel = null; // e.g. low-power mode, or the page lost focus mid-request — best-effort
  }
}

export function requestWakeLock(reason) {
  activeReasons.add(reason);
  acquire();
}

export function releaseWakeLock(reason) {
  activeReasons.delete(reason);
  if (!activeReasons.size && sentinel) { sentinel.release().catch(() => {}); sentinel = null; }
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && activeReasons.size) acquire();
  });
}
