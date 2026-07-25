// Sound system: a small event → sound registry. Ships with a synthesized
// beep as the default for every event so nothing is silent out of the box —
// dropping a real file into sounds/ and pointing an entry's `file` at it is
// a one-line change per event, no caller changes needed.
//
// iOS/Safari requires an AudioContext to be created/resumed from directly
// inside a user-gesture handler before ANY sound can play — it's unlocked on
// the app's first pointer interaction. Nothing plays once the app is fully
// closed (same platform limit as the rest timer's completion signal).
//
// The rest-timer alarm (`timer_done`) is a special case, fixed this round:
// Web Audio (used by playTone() below) plays on iOS Safari's AMBIENT audio
// channel, which iOS SILENCES whenever the ringer switch is off — exactly
// how a phone usually sits at the gym. An <audio> element plays on the MEDIA
// channel instead, which is audible with the ringer off. So the alarm is
// synthesized to a WAV at runtime (no binary asset needed) and played via a
// cached <audio> element, with `navigator.audioSession` set to 'playback'
// where the browser supports it (Safari-only, editor's-draft API — always
// feature-detected, never assumed).
const MUTE_KEY = 'soundMuted';

const SOUNDS = {
  timer_done: { file: null, freq: 880 }, // freq kept only as the playTone() fallback
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

// ── Alarm WAV synthesis (rest-timer completion) ─────────────────────────────
const ALARM_SAMPLE_RATE = 44100;

function buildAlarmSamples() {
  const freq = 1000, beepDur = 0.15, gapDur = 0.1, beeps = 4;
  const fadeSamples = Math.floor(ALARM_SAMPLE_RATE * 0.008); // 8ms fade avoids clicks
  const samples = [];
  for (let b = 0; b < beeps; b++) {
    const n = Math.floor(beepDur * ALARM_SAMPLE_RATE);
    for (let i = 0; i < n; i++) {
      const t = i / ALARM_SAMPLE_RATE;
      const fade = Math.min(1, i / fadeSamples, (n - i) / fadeSamples);
      samples.push(Math.sin(2 * Math.PI * freq * t) * 0.55 * fade);
    }
    const gapN = Math.floor(gapDur * ALARM_SAMPLE_RATE);
    for (let i = 0; i < gapN; i++) samples.push(0);
  }
  return samples;
}

function encodeWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);              // PCM
  view.setUint16(22, 1, true);              // mono
  view.setUint32(24, ALARM_SAMPLE_RATE, true);
  view.setUint32(28, ALARM_SAMPLE_RATE * 2, true); // byte rate
  view.setUint16(32, 2, true);              // block align
  view.setUint16(34, 16, true);             // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const s of samples) {
    const clamped = Math.max(-1, Math.min(1, s));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

let alarmAudio = null;
function getAlarmAudio() {
  if (!alarmAudio) {
    try {
      const url = URL.createObjectURL(encodeWav(buildAlarmSamples()));
      alarmAudio = new Audio(url);
    } catch {
      return null; // synthesis failed — caller falls back to playTone
    }
  }
  return alarmAudio;
}

function playAlarm() {
  // Editor's-draft Safari-only API — feature-detect, never assume. Routes
  // playback to the media channel so it survives the ringer switch.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
  const a = getAlarmAudio();
  if (!a) { playTone(1000); return; }
  try { a.currentTime = 0; } catch { /* not loaded yet — play() still queues it */ }
  a.play().catch(() => playTone(1000));
}

// Primes both audio paths from the required first user gesture (iOS blocks
// all audio — Web Audio AND <audio> elements — until one fires from inside a
// real pointer event). Playing+immediately pausing the alarm element here is
// the standard unlock trick for a real, pre-built element.
function unlockOnFirstGesture() {
  const c = ctx();
  if (c && c.state === 'suspended') c.resume().catch(() => {});
  const a = getAlarmAudio();
  if (a) {
    a.play().then(() => { a.pause(); a.currentTime = 0; }).catch(() => {});
  }
}
document.addEventListener('pointerdown', unlockOnFirstGesture, { once: true, passive: true });

// playSound('timer_done' | 'set_done' | 'level_up' | 'pr' | 'rank_up')
export function playSound(name) {
  if (isMuted()) return;
  if (name === 'timer_done') { playAlarm(); return; }
  const s = SOUNDS[name];
  if (!s) return;
  if (s.file) playFile(s.file);
  else playTone(s.freq);
}
