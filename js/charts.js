// Dependency-free SVG charts, themed with the app's CSS variables.
// All charts use a fixed viewBox and scale to their container width (height auto),
// with non-scaling strokes so lines stay crisp at any size.
import { fmtDate } from './ui.js';

const NS = 'http://www.w3.org/2000/svg';

function s(tag, attrs = {}, kids = []) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === 'style') n.setAttribute('style', v);
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(kids)) {
    if (c == null) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

function notEnough() {
  const d = document.createElement('div');
  d.className = 'chart-empty';
  d.textContent = 'Not enough data yet';
  return d;
}

// Wrap any chart node in a titled card.
export function chartCard(title, node, sub) {
  const card = document.createElement('div');
  card.className = 'card chart-card';
  const h = document.createElement('div');
  h.className = 'chart-title';
  h.textContent = title;
  card.append(h);
  if (sub) {
    const p = document.createElement('div');
    p.className = 'chart-sub';
    p.textContent = sub;
    card.append(p);
  }
  card.append(node);
  return card;
}

// series: [{ t: 'YYYY-MM-DD', v: number }] in ascending order.
export function lineChart(series, opts = {}) {
  const { height = 150, color = 'var(--primary-soft)', fmt = v => v } = opts;
  if (!series || series.length < 2) return notEnough();

  const W = 320, H = height, padL = 10, padR = 10, padT = 14, padB = 20;
  const vs = series.map(p => p.v);
  let min = Math.min(...vs), max = Math.max(...vs);
  if (min === max) { max = min + 1; min = min - 1; }

  const x = i => padL + (i / (series.length - 1)) * (W - padL - padR);
  const y = v => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  const linePts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const areaPts = `${padL.toFixed(1)},${(H - padB).toFixed(1)} ${linePts} ${(W - padR).toFixed(1)},${(H - padB).toFixed(1)}`;
  const gid = 'lg' + Math.random().toString(36).slice(2, 8);
  const last = series[series.length - 1];

  const defs = s('defs', {}, [
    s('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 }, [
      s('stop', { offset: '0%', style: `stop-color:${color};stop-opacity:.30` }),
      s('stop', { offset: '100%', style: `stop-color:${color};stop-opacity:0` })
    ])
  ]);

  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' }, [
    defs,
    s('polygon', { points: areaPts, fill: `url(#${gid})`, stroke: 'none' }),
    s('polyline', {
      points: linePts, fill: 'none', 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      'vector-effect': 'non-scaling-stroke', style: `stroke:${color}`
    }),
    s('circle', { cx: x(series.length - 1).toFixed(1), cy: y(last.v).toFixed(1), r: 3, style: `fill:${color}` }),
    // y max / min faint labels
    s('text', { x: padL, y: padT - 3, class: 'chart-axis' }, fmt(max)),
    s('text', { x: padL, y: H - padB + 12, class: 'chart-axis' }, fmt(min)),
    // x range
    s('text', { x: padL, y: H - 4, class: 'chart-axis' }, fmtDate(series[0].t)),
    s('text', { x: W - padR, y: H - 4, class: 'chart-axis', 'text-anchor': 'end' }, fmtDate(last.t))
  ]);
}

// bars: [{ label, value }]. Handles negative values (baseline at zero).
export function barChart(bars, opts = {}) {
  const { height = 160, color = 'var(--primary-soft)', negColor = 'var(--red)', fmt = v => v } = opts;
  if (!bars || !bars.length) return notEnough();

  const W = 320, H = height, padT = 16, padB = 30, gap = 10;
  const n = bars.length;
  const bw = Math.max(6, (W - (n + 1) * gap) / n);
  const vals = bars.map(b => b.value);
  const lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const range = (hi - lo) || 1;
  const y = v => padT + (1 - (v - lo) / range) * (H - padT - padB);
  const zeroY = y(0);

  const nodes = [];
  bars.forEach((b, i) => {
    const xx = gap + i * (bw + gap);
    const yy = y(b.value);
    const top = Math.min(yy, zeroY);
    const h = Math.max(1, Math.abs(yy - zeroY));
    nodes.push(s('rect', {
      x: xx.toFixed(1), y: top.toFixed(1), width: bw.toFixed(1), height: h.toFixed(1),
      rx: 4, style: `fill:${b.value < 0 ? negColor : color}`
    }));
    // value label
    nodes.push(s('text', {
      x: (xx + bw / 2).toFixed(1), y: (top - 4).toFixed(1), class: 'chart-val', 'text-anchor': 'middle'
    }, fmt(b.value)));
    // category label
    nodes.push(s('text', {
      x: (xx + bw / 2).toFixed(1), y: H - 10, class: 'chart-axis', 'text-anchor': 'middle'
    }, trunc(b.label, 8)));
  });

  return s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' }, nodes);
}

function trunc(str, n) {
  str = String(str || '');
  return str.length > n ? str.slice(0, n - 1) + '…' : str;
}
