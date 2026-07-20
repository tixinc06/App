// Shared UI helpers: DOM building, toasts, modals, and formatting.

// Currency symbol used across the app.
export const CUR = '£';

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
  setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 250); }, 2200);
}

// ── Modals ──────────────────────────────────────────────────────────────────
export function closeModal() {
  const h = document.getElementById('modal-host');
  h.hidden = true; h.innerHTML = '';
}
export function openModal(contentNode) {
  const h = document.getElementById('modal-host');
  h.innerHTML = '';
  h.append(el('div', { class: 'modal' }, [contentNode]));
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
        step: f.step, min: f.min, required: f.required, inputmode: f.type === 'number' ? 'decimal' : null
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

// A segmented control: options = [{value,label}]. Calls onChange(value) when a
// different segment is tapped. Returns the container node.
export function segmented(options, active, onChange) {
  const wrap = el('div', { class: 'segmented' });
  for (const o of options) {
    wrap.append(el('button', {
      type: 'button',
      class: 'segment' + (o.value === active ? ' active' : ''),
      onClick: () => { if (o.value !== active) onChange(o.value); }
    }, o.label));
  }
  return wrap;
}
