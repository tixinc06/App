// Shared UI helpers: DOM building, toasts, modals, formatting, and animation.

// Currency symbol used across the app.
export const CUR = '£';

export const prefersReducedMotion = () =>
  window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Tiny hyperscript-style DOM builder.
//   el('div', {class:'x', onClick:fn}, ['hi', childNode])
export function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

// ── Formatting ──────────────────────────────────────────────────────────────
export const money = n => {
  const v = Number(n) || 0;
  return (v < 0 ? '-' : '') + CUR +
    Math.abs(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};
export const num = n => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 1 });

// Format a Date as a LOCAL YYYY-MM-DD (never via toISOString, which uses UTC and
// can roll to the wrong day in timezones offset from UTC).
export function isoOf(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
export const todayISO = () => isoOf(new Date());
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
export function shiftDate(iso, days) {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return isoOf(d);
}

// ── Toasts ──────────────────────────────────────────────────────────────────
export function toast(msg, type = '') {
  const host = document.getElementById('toast-host');
  const t = el('div', { class: 'toast ' + type }, msg);
  host.append(t);
  setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 260); }, 2200);
}

// ── Modals ──────────────────────────────────────────────────────────────────
// A generation counter guards against a delayed close (from an animation) hiding
// a DIFFERENT modal that was opened again before the close animation finished.
let modalGen = 0;
export function closeModal() {
  const h = document.getElementById('modal-host');
  if (h.hidden) return;
  const myGen = ++modalGen;
  const finish = () => { if (myGen === modalGen) { h.hidden = true; h.innerHTML = ''; } };
  const modal = h.querySelector('.modal');
  if (modal && !prefersReducedMotion()) {
    modal.classList.add('closing');
    modal.addEventListener('animationend', finish, { once: true });
    setTimeout(finish, 240); // fallback in case animationend doesn't fire
  } else {
    finish();
  }
}
export function openModal(contentNode) {
  modalGen++; // invalidate any pending delayed close from a previous modal
  const h = document.getElementById('modal-host');
  h.innerHTML = '';
  const closeBtn = el('button', { class: 'modal-close', type: 'button', 'aria-label': 'Close', onClick: closeModal }, '✕');
  h.append(el('div', { class: 'modal' }, [closeBtn, contentNode]));
  h.hidden = false;
  h.onclick = e => { if (e.target === h) closeModal(); };
  return closeModal;
}

// Build a form-driven modal from a field spec.
// fields: [{ name, label, type, value, placeholder, required, step, min, options, help }]
// onSubmit(values) — may be async; throw to show an error and keep the modal open.
export function formModal({ title, fields, submitText = 'Save', onSubmit }) {
  const form = el('form');
  const inputs = {};
  for (const f of fields) {
    let input;
    if (f.type === 'textarea') {
      input = el('textarea', { placeholder: f.placeholder || '' });
    } else if (f.type === 'select') {
      input = el('select');
      for (const o of f.options) input.append(el('option', { value: o.value }, o.label));
    } else {
      input = el('input', {
        type: f.type || 'text', placeholder: f.placeholder || '',
        step: f.step, min: f.min, max: f.max, required: f.required, inputmode: f.type === 'number' ? 'decimal' : null
      });
    }
    if (f.value != null) input.value = f.value;
    inputs[f.name] = input;
    form.append(el('label', {}, [f.label, input, f.help ? el('small', { class: 'dim' }, f.help) : null]));
  }
  const err = el('p', { class: 'form-error', hidden: true });
  const btn = el('button', { type: 'submit', class: 'btn btn-primary btn-block' }, submitText);
  form.append(err, btn);

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const values = {};
    for (const f of fields) {
      const input = inputs[f.name];
      if (f.type === 'file') values[f.name] = input.files[0] || null;
      else if (f.type === 'number') values[f.name] = input.value === '' ? null : Number(input.value);
      else values[f.name] = input.value.trim ? input.value.trim() : input.value;
    }
    err.hidden = true; btn.disabled = true; btn.textContent = 'Saving…';
    try {
      await onSubmit(values);
      closeModal();
    } catch (ex) {
      err.textContent = ex.message || 'Something went wrong.';
      err.hidden = false; btn.disabled = false; btn.textContent = submitText;
    }
  });

  openModal(el('div', {}, [el('h3', {}, title), form]));
  const first = form.querySelector('input,select,textarea');
  if (first) setTimeout(() => first.focus(), 60);
}

// Simple yes/no confirmation. onConfirm may be async.
export function confirmModal({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = true, onConfirm }) {
  const yes = el('button', { class: 'btn ' + (danger ? 'btn-danger' : 'btn-primary') }, confirmText);
  const no = el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Cancel');
  yes.addEventListener('click', async () => {
    yes.disabled = true; yes.textContent = 'Working…';
    try { await onConfirm(); closeModal(); }
    catch (ex) { toast(ex.message || 'Failed', 'err'); yes.disabled = false; yes.textContent = confirmText; }
  });
  openModal(el('div', {}, [
    el('h3', {}, title),
    message ? el('p', { class: 'muted', style: 'margin-bottom:18px' }, message) : null,
    el('div', { class: 'modal-actions' }, [no, yes])
  ]));
}

// A reusable action sheet: list of { label, danger, onClick } buttons.
export function actionSheet(title, actions) {
  const btns = actions.map(a =>
    el('button', {
      class: 'btn btn-block ' + (a.primary ? 'btn-primary' : a.danger ? 'btn-danger' : 'btn-ghost'),
      style: 'margin-bottom:10px',
      onClick: () => { closeModal(); a.onClick(); }
    }, a.label)
  );
  openModal(el('div', {}, [
    el('h3', {}, title),
    ...btns,
    el('button', { class: 'btn btn-ghost btn-block', onClick: closeModal }, 'Close')
  ]));
}

// Standard empty-state block.
export function emptyState(emoji, text) {
  return el('div', { class: 'empty' }, [el('div', { class: 'big' }, emoji), el('div', {}, text)]);
}

// ── Animation helpers ────────────────────────────────────────────────────────

// Marks each child of `container` to fade/slide in with a staggered delay.
// Call AFTER all children are appended. `max` caps how many get a distinct delay
// (later items reuse the last delay so a long list doesn't take forever to settle).
export function staggerChildren(container, max = 12) {
  if (!container) return;
  [...container.children].forEach((child, i) => {
    child.classList.add('stagger-item');
    child.style.setProperty('--i', String(Math.min(i, max)));
  });
}

// Shimmering placeholder cards shown while a view's data is loading.
// variant: 'item' (list row), 'stat' (stat-grid cell), 'block' (large card), or 'grid' (2-col cards).
export function skeleton(count = 3, variant = 'item') {
  if (variant === 'stat') {
    const wrap = el('div', { class: 'stat-grid' });
    for (let i = 0; i < count; i++) wrap.append(el('div', { class: 'skeleton skel-stat' }));
    return wrap;
  }
  if (variant === 'block') {
    return el('div', { class: 'skeleton skel-block' });
  }
  if (variant === 'grid') {
    const wrap = el('div', { class: 'product-grid' });
    for (let i = 0; i < count; i++) wrap.append(el('div', { class: 'skeleton', style: 'aspect-ratio:1;' }));
    return wrap;
  }
  const wrap = el('div', { class: 'list' });
  for (let i = 0; i < count; i++) wrap.append(el('div', { class: 'skeleton skel-item' }));
  return wrap;
}

// Animates a numeric headline from 0 up to `target`, formatting each frame with
// `formatFn` (e.g. money, num). Snaps straight to the final value if the user
// prefers reduced motion.
// Uses setTimeout (not requestAnimationFrame) so the animation still runs when
// the tab is backgrounded/not yet painted (rAF is suspended in that case).
export function countUp(node, target, formatFn = String, duration = 650) {
  if (!node) return;
  const value = Number(target) || 0;
  if (prefersReducedMotion()) { node.textContent = formatFn(value); return; }
  const start = performance.now();
  const step = 16;
  function tick() {
    const p = Math.min(1, (performance.now() - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    node.textContent = formatFn(value * eased);
    if (p < 1) setTimeout(tick, step);
    else node.textContent = formatFn(value);
  }
  tick();
}

// A short confetti burst to celebrate a win (e.g. logging a sale).
export function celebrate() {
  if (prefersReducedMotion()) return;
  const colors = ['#6d5efc', '#9b8dff', '#22d99a', '#ffb341', '#3fb6f0', '#ff5470'];
  const pieces = [];
  for (let i = 0; i < 26; i++) {
    const dx = (Math.random() - 0.5) * 340;
    const dy = 180 + Math.random() * 240;
    const rot = (Math.random() - 0.5) * 720;
    const p = el('div', { class: 'confetti-piece' });
    p.style.background = colors[i % colors.length];
    p.style.left = (42 + Math.random() * 16) + '%';
    p.style.setProperty('--dx', dx.toFixed(0) + 'px');
    p.style.setProperty('--dy', dy.toFixed(0) + 'px');
    p.style.setProperty('--rot', rot.toFixed(0) + 'deg');
    p.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
    document.body.append(p);
    pieces.push(p);
  }
  setTimeout(() => pieces.forEach(p => p.remove()), 1500);
}

// ── Tap ripple ────────────────────────────────────────────────────────────────
// A single delegated pointerdown listener spawns a ripple on any matching
// element. Runs once, at module load, since ui.js is a singleton import.
const RIPPLE_SELECTOR = '.btn, .card.item, .home-card, .segment, .product-card, ' +
  '.cal-day.has-sales, .fab, #back-btn, #logout-btn, .link';

function initRipples() {
  document.addEventListener('pointerdown', e => {
    if (prefersReducedMotion()) return;
    const target = e.target.closest(RIPPLE_SELECTOR);
    if (!target) return;
    const rect = target.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const size = Math.max(rect.width, rect.height) * 1.3;
    const span = el('span', { class: 'ripple-el' });
    span.style.width = span.style.height = size + 'px';
    span.style.left = (e.clientX - rect.left - size / 2) + 'px';
    span.style.top = (e.clientY - rect.top - size / 2) + 'px';
    const cs = getComputedStyle(target);
    if (cs.position === 'static') target.style.position = 'relative';
    if (cs.overflow === 'visible') target.style.overflow = 'hidden';
    target.appendChild(span);
    span.addEventListener('animationend', () => span.remove(), { once: true });
    setTimeout(() => span.remove(), 700);
  }, { passive: true });
}
initRipples();

// A segmented control: options = [{value,label}]. Calls onChange(value) when a
// different segment is tapped. Returns the container node. The active segment
// is highlighted by a sliding indicator pill that animates between positions.
export function segmented(options, active, onChange) {
  const wrap = el('div', { class: 'segmented' });
  const indicator = el('div', { class: 'segment-indicator' });
  wrap.append(indicator);
  const buttons = options.map(o => {
    const btn = el('button', {
      type: 'button',
      class: 'segment' + (o.value === active ? ' active' : ''),
      onClick: () => { if (o.value !== active) onChange(o.value); }
    }, o.label);
    wrap.append(btn);
    return btn;
  });
  const activeBtn = buttons[Math.max(0, options.findIndex(o => o.value === active))];
  // Deferred (not requestAnimationFrame, which is suspended on a backgrounded/
  // not-yet-painted tab) so `wrap` is guaranteed attached to the live DOM by the
  // caller before we measure offsetWidth/offsetLeft (both read as 0 while detached).
  setTimeout(() => {
    if (!activeBtn) return;
    indicator.style.width = activeBtn.offsetWidth + 'px';
    indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
  }, 0);
  return wrap;
}
