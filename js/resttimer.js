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

const STATE_KEY = 'restTimerState';       // {endsAt, paused, pausedRemainingMs}
const DURATION_KEY = 'restTimerDuration'; // last-used seconds

let state = null;
let barEl, timeEl, pauseBtn;
let tickHandle = null;

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
  timeEl.textContent = fmt(remainingMs());
  pauseBtn.textContent = state.paused ? '▶' : '⏸';
}

function tick() {
  if (!state) return;
  if (!state.paused && remainingMs() <= 0) { finish(); return; }
  render();
}

function startTicking() {
  stopTicking();
  tickHandle = setInterval(tick, 250);
  render();
}
function stopTicking() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
}

export function requestNotifyPermission() {
  try {
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  } catch { /* unsupported — vibrate/beep still work */ }
}

export function startRestTimer(seconds) {
  const durationMs = Math.max(0, Number(seconds) || 0) * 1000;
  saveLastDuration(Math.round(durationMs / 1000));
  state = { endsAt: new Date(Date.now() + durationMs).toISOString(), paused: false, pausedRemainingMs: durationMs };
  persist();
  requestNotifyPermission();
  startTicking();
}

function togglePause() {
  if (!state) return;
  if (state.paused) {
    state.endsAt = new Date(Date.now() + state.pausedRemainingMs).toISOString();
    state.paused = false;
  } else {
    state.pausedRemainingMs = remainingMs();
    state.paused = true;
  }
  persist();
  render();
}

function addSeconds(sec) {
  if (!state) return;
  if (state.paused) state.pausedRemainingMs = Math.max(0, state.pausedRemainingMs + sec * 1000);
  else state.endsAt = new Date(new Date(state.endsAt).getTime() + sec * 1000).toISOString();
  persist();
  render();
}

function skip() {
  state = null;
  persist();
  stopTicking();
  render();
}

function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    osc.start(); osc.stop(ctx.currentTime + 0.6);
  } catch { /* AudioContext unsupported/blocked — vibrate is still primary */ }
}

async function finish() {
  stopTicking();
  state = null;
  persist();
  render();
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* unsupported */ }
  playBeep();
  try {
    if ('serviceWorker' in navigator && window.Notification?.permission === 'granted') {
      const reg = await navigator.serviceWorker.ready;
      reg.showNotification('Rest finished 💪', { body: 'Time to lift.', tag: 'rest-timer', renotify: true });
    }
  } catch { /* best-effort — vibrate/beep already fired */ }
}

// Mounts the floating bar once, at app-shell level (call from js/app.js after
// login). Resumes any in-flight timer from localStorage — the countdown is
// re-derived from the stored endsAt, so a reload mid-rest stays accurate.
export function mountRestTimer() {
  if (barEl) return;
  timeEl = el('span', { class: 'rt-time' }, '0:00');
  pauseBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: togglePause }, '⏸');
  barEl = el('div', { class: 'rest-timer-bar', hidden: true }, [
    el('span', { class: 'rt-label' }, '💤 Rest'),
    timeEl,
    el('div', { class: 'rt-actions' }, [
      pauseBtn,
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => addSeconds(15) }, '+15s'),
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: skip }, 'Skip')
    ])
  ]);
  document.body.append(barEl);

  const saved = loadPersisted();
  if (saved) {
    state = saved;
    if (!state.paused && remainingMs() <= 0) { state = null; persist(); }
    else startTicking();
  }
  render();
}

// A small ±15s duration picker (0:00–5:00), used inside the workout builder
// to set/adjust the rest length before/while training.
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
