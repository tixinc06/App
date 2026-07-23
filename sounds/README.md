Drop audio files here (short .mp3/.ogg, a few hundred KB max) and point the
matching entry's `file` at `sounds/<name>` in `js/sound.js`'s `SOUNDS` map —
e.g. `timer_done: { file: 'sounds/timer_done.mp3' }`. No other code changes
needed; every event falls back to a synthesized beep until a file is set.
