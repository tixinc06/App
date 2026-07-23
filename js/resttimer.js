// Global rest timer: a floating bar mounted once at the app-shell level
// (js/app.js), visible on whichever tab you're on. State is derived from a
// stored end-timestamp (never a naive decrementing counter), so it stays
// accurate across backgrounding/throttling and even survives a reload.
//
// Platform note: the countdown itself is always accurate. A completion
// NOTIFICATION can only fire while the page/SW is alive — if iOS fully kills
// the app, no notification arrives. Vibration + a beep are the dependable
// primary signal; the notification is a bonus when the platform allows it.
import { el } from './ui.js';
import { playSound } from './sound.js';

const STATE_KEY = 'restTimerState';       // {endsAt, paused, pausedRemainingMs, durationMs}
const DURATION_KEY = 'restTimerDuration'; // last-used seconds
const RING_R = 20;
const RING_C = 2 * Math.PI * RING_R;

let state = null;
let barEl, timeEl, pauseBtn, ringProgress;
let displayHandle = null;   // foreground UI refresh (~250ms), purely cosmetic
let completionHandle = null; // a single precisely-armed setTimeout for the actual finish

export function loadLastDuration() {
  const v = Number(localStorage.getItem(DURATION_KEY));
  return v > 0 && v <= 300 ? v : 180;
}
function saveLastDuration(sec) {
  localStorage.setItem(DURATION_KEY, String(sec));
}

function persist() {
  if (state) localStorage.setItem(STATE_KEY, JSON.stringify(state));
  else localStorage.removeItem(STATE_KEY);
}
function loadPersisted() {
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function remainingMs() {
  if (!state) return 0;
  if (state.paused) return state.pausedRemainingMs;
  return Math.max(0, new Date(state.endsAt).getTime() - Date.now());
}

function fmt(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function render() {
  if (!barEl) return;
  if (!state) { barEl.hidden = true; return; }
  barEl.hidden = false;
  const rem = remainingMs();
  timeEl.textContent = fmt(rem);
  pauseBtn.textContent = state.paused ? '▶' : '⏸';
  const pct = state.durationMs > 0 ? Math.max(0, Math.min(1, rem / state.durationMs)) : 0;
  ringProgress.setAttribute('stroke-dashoffset', String(RING_C * (1 - pct)));
  barEl.classList.toggle('rt-urgent', !state.paused && rem > 0 && rem <= 10000);
}

// Precisely re-armed at the exact remaining ms, so completion fires as close
// to on-time as possible even while a clamped/throttled interval would lag.
function armCompletionTimer() {
  clearCompletionTimer();
  if (!state || state.paused) return;
  const ms = remainingMs();
  if (ms <= 0) { finish(); return; }
  completionHandle = setTimeout(() => {
    if (state && !state.paused && remainingMs() <= 50) finish();
    else armCompletionTimer(); // guard against timer-throttle drift — retry
  }, ms);
}
function clearCompletionTimer() {
  if (completionHandle) { clearTimeout(completionHandle); completionHandle = null; }
}

function startDisplayLoop() {
  stopDisplayLoop();
  displayHandle = setInterval(() => {
    if (!state) return;
    if (!state.paused && remainingMs() <= 0) { finish(); return; }
    render();
  }, 250);
  render();
}
function stopDisplayLoop() {
  if (displayHandle) { clearInterval(displayHandle); displayHandle = null; }
}

function startTicking() {
  startDisplayLoop();
  armCompletionTimer();
}
function stopTicking() {
  stopDisplayLoop();
  clearCompletionTimer();
}

// Re-syncs the moment the app becomes visible/foregrounded again — without
// this, a backgrounded/throttled tab can look frozen until the next tick.
function syncNow() {
  if (!state) { render(); return; }
  if (!state.paused && remainingMs() <= 0) { finish(); return; }
  render();
  if (!state.paused) armCompletionTimer();
}

export function requestNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch { /* unsupported — vibrate/beep still work */ }
}

export function startRestTimer(seconds) {
  const durationMs = Math.max(0, Number(seconds) || 0) * 1000;
  saveLastDuration(Math.round(durationMs / 1000));
  state = { endsAt: new Date(Date.now() + durationMs).toISOString(), paused: false, pausedRemainingMs: durationMs, durationMs };
  persist();
  requestNotifyPermission();
  startTicking();
}

function togglePause() {
  if (!state) return;
  if (state.paused) {
    state.endsAt = new Date(Date.now() + state.pausedRemainingMs).toISOString();
    state.paused = false;
    armCompletionTimer();
  } else {
    state.pausedRemainingMs = remainingMs();
    state.paused = true;
    clearCompletionTimer();
  }
  persist();
  render();
}

function addSeconds(sec) {
  if (!state) return;
  state.durationMs = Math.max(0, state.durationMs + sec * 1000);
  if (state.paused) state.pausedRemainingMs = Math.max(0, state.pausedRemainingMs + sec * 1000);
  else state.endsAt = new Date(new Date(state.endsAt).getTime() + sec * 1000).toISOString();
  persist();
  render();
  if (!state.paused) armCompletionTimer();
}

function skip() {
  state = null;
  persist();
  stopTicking();
  render();
}

async function finish() {
  stopTicking();
  state = null;
  persist();
  render();
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* unsupported */ }
  playSound('timer_done');
  flashFinished();
  try {
    if ('serviceWorker' in navigator && window.Notification?.permission === 'granted') {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('Rest finished 💪', { body: 'Time to lift.', tag: 'rest-timer', renotify: true });
    }
  } catch { /* best-effort — vibrate/beep already fired */ }
}

// A brief "Rest finished" toast-like flash — covers the case where the timer
// expired while the app was backgrounded/closed and the bar simply vanished
// (see mountRestTimer): the user still gets a clear signal on return.
function flashFinished() {
  const flash = el('div', { class: 'rt-finished-flash' }, '💪 Rest finished');
  document.body.append(flash);
  requestAnimationFrame(() => flash.classList.add('show'));
  setTimeout(() => { flash.classList.remove('show'); setTimeout(() => flash.remove(), 300); }, 2200);
}

// Mounts the floating bar once, at app-shell level (call from js/app.js after
// login). Resumes any in-flight timer from localStorage — the countdown is
// re-derived from the stored endsAt, so a reload mid-rest stays accurate. If
// the timer expired while the app was fully closed/backgrounded, fire the
// completion signal now instead of silently discarding it.
export function mountRestTimer() {
  if (barEl) return;
  timeEl = el('span', { class: 'rt-time' }, '0:00');
  pauseBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost rt-icon-btn', onClick: togglePause }, '⏸');
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('class', 'rt-ring');
  const defs = document.createElementNS(svgNS, 'defs');
  const grad = document.createElementNS(svgNS, 'linearGradient');
  grad.setAttribute('id', 'rt-ring-grad');
  grad.setAttribute('x1', '0%'); grad.setAttribute('y1', '0%');
  grad.setAttribute('x2', '100%'); grad.setAttribute('y2', '100%');
  const stop1 = document.createElementNS(svgNS, 'stop');
  stop1.setAttribute('offset', '0%'); stop1.setAttribute('class', 'rt-grad-a');
  const stop2 = document.createElementNS(svgNS, 'stop');
  stop2.setAttribute('offset', '100%'); stop2.setAttribute('class', 'rt-grad-b');
  grad.append(stop1, stop2);
  defs.append(grad);
  svg.append(defs);
  const track = document.createElementNS(svgNS, 'circle');
  track.setAttribute('cx', '24'); track.setAttribute('cy', '24'); track.setAttribute('r', String(RING_R));
  track.setAttribute('class', 'rt-ring-track');
  const progress = document.createElementNS(svgNS, 'circle');
  progress.setAttribute('cx', '24'); progress.setAttribute('cy', '24'); progress.setAttribute('r', String(RING_R));
  progress.setAttribute('class', 'rt-ring-progress');
  progress.setAttribute('stroke-dasharray', String(RING_C));
  progress.setAttribute('stroke-dashoffset', '0');
  svg.append(track, progress);
  ringProgress = progress;

  barEl = el('div', { class: 'rest-timer-bar', hidden: true }, [
    el('div', { class: 'rt-ring-wrap' }, [svg, timeEl]),
    el('div', { class: 'rt-label' }, '💤 Rest'),
    el('div', { class: 'rt-actions' }, [
      pauseBtn,
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost rt-icon-btn', onClick: () => addSeconds(15) }, '+15s'),
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost rt-icon-btn', onClick: skip }, '✕')
    ])
  ]);
  document.body.append(barEl);

  const saved = loadPersisted();
  if (saved) {
    state = saved;
    if (state.durationMs === undefined) state.durationMs = state.pausedRemainingMs || 0;
    if (!state.paused && remainingMs() <= 0) {
      // Expired while backgrounded/closed — fire the missed completion now
      // rather than discarding it silently.
      finish();
    } else {
      startTicking();
    }
  }
  render();

  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncNow(); });
  window.addEventListener('focus', syncNow);
  window.addEventListener('pageshow', syncNow);
}

// A ±15s duration picker (0:00–5:00), used inside the workout builder to
// set/adjust the rest length before/while training.
export function durationPickerEl(initialSeconds, onChange) {
  let seconds = Math.min(300, Math.max(0, initialSeconds));
  const label = el('span', { class: 'rt-picker-time' }, fmt(seconds * 1000));
  function set(v) {
    seconds = Math.min(300, Math.max(0, v));
    label.textContent = fmt(seconds * 1000);
    onChange(seconds);
  }
  return el('div', { class: 'rt-picker' }, [
    el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => set(seconds - 15) }, '−'),
    label,
    el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => set(seconds + 15) }, '+')
  ]);
}
