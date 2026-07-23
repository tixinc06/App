// Sound system: a small event → sound registry. Ships with a synthesized
// beep as the default for every event so nothing is silent out of the box —
// dropping a real file into sounds/ and pointing an entry's `file` at it is
// a one-line change per event, no caller changes needed.
//
// iOS/Safari requires an AudioContext to be created/resumed from directly
// inside a user-gesture handler before ANY sound can play — it's unlocked on
// the app's first pointer interaction. Nothing plays once the app is fully
// closed (same platform limit as the rest timer's completion signal).
const MUTE_KEY = 'soundMuted';

const SOUNDS = {
  timer_done: { file: null, freq: 880 },
  set_done: { file: null, freq: 660 },
  level_up: { file: null, freq: 990 },
  pr: { file: null, freq: 1180 },
  rank_up: { file: null, freq: 1320 }
};

export function isMuted() {
  return localStorage.getItem(MUTE_KEY) === '1';
}
export function setMuted(v) {
  localStorage.setItem(MUTE_KEY, v ? '1' : '0');
}
export function toggleMuted() {
  setMuted(!isMuted());
  return isMuted();
}

let audioCtx = null;
function ctx() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  return audioCtx;
}

function unlockOnFirstGesture() {
  const c = ctx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
}
document.addEventListener('pointerdown', unlockOnFirstGesture, { once: true, passive: true });

function playTone(freq) {
  const c = ctx();
  if (!c) return;
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.connect(gain); gain.connect(c.destination);
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.18, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.5);
  osc.start(); osc.stop(c.currentTime + 0.5);
}

const fileCache = {};
function playFile(file) {
  let a = fileCache[file];
  if (!a) { a = new Audio(file); fileCache[file] = a; }
  try { a.currentTime = 0; } catch { /* not loaded yet — play() still queues it */ }
  a.play().catch(() => { /* blocked (no gesture yet) or unsupported — silent no-op */ });
}

// playSound('timer_done' | 'set_done' | 'level_up' | 'pr' | 'rank_up')
export function playSound(name) {
  if (isMuted()) return;
  const s = SOUNDS[name];
  if (!s) return;
  if (s.file) playFile(s.file);
  else playTone(s.freq);
}
