// Exercise thumbnail art: the single swap-in point for exercise imagery,
// mirroring js/rankart.js's pattern exactly (that module maps a rank GROUP
// name to an image + colour; this one maps an EXERCISE NAME + muscle group to
// a hand-drawn flat-SVG "archetype" icon + colour). Nothing outside this file
// knows about actual art — everything else just calls exerciseThumb(name, group).
//
// I can't generate illustrated raster figures (the reference screenshots'
// style) — these are simple flat-SVG pictograms instead: a circle head + line
// limbs + a piece of equipment, distinct enough per archetype to read at 44px.
// EXERCISE_ART below is an initially-empty per-exercise override map — dropping
// a real illustration file in later is a one-line addition, no call-site changes.
const NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, kids = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) if (c != null) n.append(c);
  return n;
}

// Shared limb/figure primitives — every archetype composes from these so the
// whole set reads as one consistent pictogram family. All in a 0 0 100 100
// viewBox; FIG is the stroke colour for the person, EQUIP the accent colour
// for whatever they're using.
const FIG = 'var(--text)';
function head(cx, cy, r = 8) { return s('circle', { cx, cy, r, fill: FIG }); }
function line(x1, y1, x2, y2, color = FIG, w = 5) {
  return s('line', { x1, y1, x2, y2, stroke: color, 'stroke-width': w, 'stroke-linecap': 'round' });
}

const ARCHETYPES = {
  'barbell-bench': {
    color: '#6d8bff',
    draw: () => [
      s('rect', { x: 22, y: 62, width: 56, height: 8, rx: 3, fill: 'var(--muted-dim)' }),
      head(50, 40),
      line(50, 48, 50, 62),
      line(50, 78, 40, 60), line(50, 78, 60, 60),
      line(28, 30, 72, 30, 'var(--primary-soft)', 6),
      s('circle', { cx: 24, cy: 30, r: 9, fill: 'var(--primary-soft)' }),
      s('circle', { cx: 76, cy: 30, r: 9, fill: 'var(--primary-soft)' }),
      line(50, 30, 50, 40, FIG, 4)
    ]
  },
  squat: {
    color: '#ff9f43',
    draw: () => [
      head(50, 28),
      line(50, 36, 50, 55),
      line(50, 55, 36, 78), line(50, 55, 64, 78),
      line(36, 78, 32, 62), line(64, 78, 68, 62),
      line(26, 34, 74, 34, 'var(--primary-soft)', 6),
      s('circle', { cx: 24, cy: 34, r: 8, fill: 'var(--primary-soft)' }),
      s('circle', { cx: 76, cy: 34, r: 8, fill: 'var(--primary-soft)' })
    ]
  },
  deadlift: {
    color: '#ff5e7e',
    draw: () => [
      head(34, 34),
      line(34, 42, 58, 62),
      line(58, 62, 48, 82), line(58, 62, 68, 82),
      line(40, 46, 20, 62),
      line(15, 62, 68, 62, 'var(--primary-soft)', 6),
      s('circle', { cx: 15, cy: 62, r: 9, fill: 'var(--primary-soft)' }),
      s('circle', { cx: 68, cy: 62, r: 9, fill: 'var(--primary-soft)' })
    ]
  },
  pullup: {
    color: '#22c9a6',
    draw: () => [
      line(15, 22, 85, 22, 'var(--muted-dim)', 6),
      head(50, 40),
      line(50, 48, 35, 28), line(35, 28, 20, 22),
      line(50, 48, 65, 28), line(65, 28, 80, 22),
      line(50, 48, 50, 70),
      line(50, 70, 42, 88), line(50, 70, 58, 88)
    ]
  },
  row: {
    color: '#8b6dff',
    draw: () => [
      head(66, 34),
      line(66, 42, 46, 55),
      line(46, 55, 40, 78), line(46, 55, 58, 78),
      line(58, 46, 30, 50),
      line(30, 50, 18, 50, 'var(--primary-soft)', 5),
      s('circle', { cx: 15, cy: 50, r: 7, fill: 'var(--primary-soft)' })
    ]
  },
  ohp: {
    color: '#ffb341',
    draw: () => [
      head(50, 34),
      line(50, 42, 50, 68),
      line(50, 68, 40, 88), line(50, 68, 60, 88),
      line(50, 44, 32, 22), line(50, 44, 68, 22),
      line(20, 22, 80, 22, 'var(--primary-soft)', 6),
      s('circle', { cx: 18, cy: 22, r: 8, fill: 'var(--primary-soft)' }),
      s('circle', { cx: 82, cy: 22, r: 8, fill: 'var(--primary-soft)' })
    ]
  },
  curl: {
    color: '#3fb6f0',
    draw: () => [
      head(50, 30),
      line(50, 38, 50, 66),
      line(50, 66, 40, 88), line(50, 66, 60, 88),
      line(50, 44, 34, 50),
      line(34, 50, 34, 34, 'var(--primary-soft)', 5),
      s('circle', { cx: 34, cy: 30, r: 8, fill: 'var(--primary-soft)' }),
      line(50, 44, 66, 60)
    ]
  },
  raise: {
    color: '#ff8ac6',
    draw: () => [
      head(50, 30),
      line(50, 38, 50, 66),
      line(50, 66, 40, 88), line(50, 66, 60, 88),
      line(50, 44, 22, 40),
      line(50, 44, 78, 40),
      s('circle', { cx: 18, cy: 40, r: 7, fill: 'var(--primary-soft)' }),
      s('circle', { cx: 82, cy: 40, r: 7, fill: 'var(--primary-soft)' })
    ]
  },
  'cable-triceps': {
    color: '#22d99a',
    draw: () => [
      s('circle', { cx: 50, cy: 14, r: 6, fill: 'var(--muted-dim)' }),
      line(50, 20, 50, 46, 'var(--muted-dim)', 3),
      head(50, 56),
      line(50, 64, 50, 88),
      line(50, 70, 34, 78), line(50, 70, 66, 78),
      line(50, 46, 38, 62), line(38, 62, 34, 78)
    ]
  },
  core: {
    color: '#ffd166',
    draw: () => [
      head(24, 66),
      line(32, 66, 58, 66),
      line(58, 66, 58, 46), line(58, 66, 74, 60),
      line(58, 46, 74, 40)
    ]
  },
  run: {
    color: '#5ac8ff',
    draw: () => [
      head(46, 26),
      line(46, 34, 58, 54),
      line(58, 54, 76, 44),
      line(58, 54, 42, 80),
      line(46, 34, 26, 44),
      line(46, 34, 60, 20)
    ]
  },
  bike: {
    color: '#a78bfa',
    draw: () => [
      s('circle', { cx: 26, cy: 74, r: 14, fill: 'none', stroke: 'var(--muted-dim)', 'stroke-width': 4 }),
      s('circle', { cx: 74, cy: 74, r: 14, fill: 'none', stroke: 'var(--muted-dim)', 'stroke-width': 4 }),
      line(26, 74, 50, 50), line(50, 50, 74, 74), line(50, 50, 42, 30), line(26, 74, 62, 74),
      head(50, 22)
    ]
  },
  'jump-rope': {
    color: '#f97878',
    draw: () => [
      head(50, 26),
      line(50, 34, 50, 60),
      line(50, 60, 42, 88), line(50, 60, 58, 88),
      line(50, 40, 34, 50), line(50, 40, 66, 50),
      s('ellipse', { cx: 50, cy: 70, rx: 26, ry: 20, fill: 'none', stroke: 'var(--primary-soft)', 'stroke-width': 4 })
    ]
  },
  machine: {
    color: '#9ca3ff',
    draw: () => [
      s('rect', { x: 62, y: 16, width: 14, height: 44, rx: 2, fill: 'var(--muted-dim)' }),
      line(62, 26, 44, 40, 'var(--primary-soft)', 5),
      head(38, 40),
      line(38, 48, 38, 70),
      line(38, 58, 26, 64), line(38, 58, 50, 64),
      s('rect', { x: 22, y: 70, width: 32, height: 8, rx: 3, fill: 'var(--muted-dim)' })
    ]
  },
  kettlebell: {
    color: '#ff9f43',
    draw: () => [
      s('path', { d: 'M42,30 a8,8 0 0 1 16,0 v6 h-16 z', fill: 'none', stroke: 'var(--primary-soft)', 'stroke-width': 4 }),
      s('rect', { x: 34, y: 36, width: 32, height: 30, rx: 14, fill: 'var(--primary-soft)' }),
      head(50, 78),
      line(50, 86, 40, 96), line(50, 86, 60, 96)
    ]
  },
  dumbbell: {
    color: '#8b8fa3',
    draw: () => [
      s('rect', { x: 42, y: 44, width: 16, height: 12, rx: 2, fill: FIG }),
      s('rect', { x: 18, y: 34, width: 12, height: 32, rx: 3, fill: 'var(--primary-soft)' }),
      s('rect', { x: 70, y: 34, width: 12, height: 32, rx: 3, fill: 'var(--primary-soft)' })
    ]
  }
};

const NAME_RULES = [
  [/bench|chest press/i, 'barbell-bench'],
  [/squat/i, 'squat'],
  [/deadlift|romanian/i, 'deadlift'],
  [/pull-?up|chin-?up|pulldown/i, 'pullup'],
  [/row/i, 'row'],
  [/overhead|shoulder press|arnold/i, 'ohp'],
  [/curl/i, 'curl'],
  [/raise|fly/i, 'raise'],
  [/pushdown|triceps|skull/i, 'cable-triceps'],
  [/plank|crunch|sit-?up|twist|leg raise|ab wheel/i, 'core'],
  [/run/i, 'run'],
  [/cycl|bike/i, 'bike'],
  [/rope/i, 'jump-rope'],
  [/machine/i, 'machine'],
  [/kettlebell/i, 'kettlebell']
];

// Per-muscle-group default when no name keyword matches — keeps a custom or
// unrecognised exercise from ever falling back to nothing.
const GROUP_DEFAULT = {
  Chest: 'barbell-bench', Back: 'row', Legs: 'squat', Shoulders: 'ohp',
  Arms: 'curl', Core: 'core', Cardio: 'run', Custom: 'dumbbell'
};

export function archetypeFor(name, group) {
  const n = (name || '').trim();
  for (const [re, key] of NAME_RULES) if (re.test(n)) return key;
  return GROUP_DEFAULT[group] || 'dumbbell';
}

// Per-exercise-name override — empty until real art is supplied. A slug here
// renders an <img src=EXERCISE_ART[slug]> instead of the SVG archetype.
export const EXERCISE_ART = {};
function slugOf(name) {
  return (name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// The circular tile — the eg5/eg6 visual. `size` in px.
export function exerciseThumb(name, group, { size = 44 } = {}) {
  const override = EXERCISE_ART[slugOf(name)];
  if (override) {
    const img = document.createElement('img');
    img.src = override; img.alt = name || '';
    img.className = 'ex-thumb';
    img.style.width = img.style.height = size + 'px';
    return img;
  }

  const key = archetypeFor(name, group);
  const archetype = ARCHETYPES[key] || ARCHETYPES.dumbbell;
  const svg = s('svg', { viewBox: '0 0 100 100', class: 'ex-thumb-svg' }, archetype.draw());
  const wrap = document.createElement('div');
  wrap.className = 'ex-thumb';
  wrap.style.width = wrap.style.height = size + 'px';
  wrap.style.setProperty('--ex-thumb-color', archetype.color);
  wrap.append(svg);
  return wrap;
}
