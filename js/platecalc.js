// Plate-loading calculator: target total weight + bar weight + available
// plate set -> plates needed per side (greedy largest-first). Pure client
// math, no schema, no server round-trip.
import { el, num, openModal } from './ui.js';
import { weightUnit, defaultBarWeight, defaultPlateSet } from './units.js';

// Greedy largest-plate-first breakdown. Returns { counts: {plateKg: count},
// remainder } — remainder is any leftover weight that can't be made exactly
// with the available plates (shown to the user rather than hidden).
export function calcPlatesPerSide(perSide, availablePlates) {
  const sorted = [...availablePlates].filter(p => p > 0).sort((a, b) => b - a);
  const counts = {};
  let remaining = Math.max(0, perSide);
  for (const p of sorted) {
    const n = Math.floor((remaining + 1e-9) / p);
    if (n > 0) {
      counts[p] = n;
      remaining = Math.round((remaining - n * p) * 1000) / 1000;
    }
  }
  return { counts, remainder: remaining };
}

export function plateCalculatorModal() {
  const unit = weightUnit();
  const targetInput = el('input', { type: 'number', inputmode: 'decimal', step: '0.5', min: '0', placeholder: `e.g. ${unit === 'lb' ? '225' : '100'}`, style: 'margin-top:0' });
  const barInput = el('input', { type: 'number', inputmode: 'decimal', step: '0.5', min: '0', value: defaultBarWeight(), style: 'margin-top:0' });
  const platesInput = el('input', { value: defaultPlateSet().join(', '), style: 'margin-top:0' });
  const resultEl = el('div', { style: 'margin-top:16px' });

  function recompute() {
    resultEl.innerHTML = '';
    const target = Number(targetInput.value);
    const bar = Number(barInput.value) || 0;
    const available = platesInput.value.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n) && n > 0);
    if (!target || target <= 0) {
      resultEl.append(el('div', { class: 'muted' }, 'Enter a target total weight.'));
      return;
    }
    if (target < bar) {
      resultEl.append(el('div', { class: 'form-error' }, `Target is less than the bar weight (${num(bar)}${unit}).`));
      return;
    }
    const perSide = (target - bar) / 2;
    if (!available.length) {
      resultEl.append(el('div', { class: 'muted' }, 'Enter at least one available plate weight.'));
      return;
    }
    const { counts, remainder } = calcPlatesPerSide(perSide, available);
    const entries = Object.entries(counts).map(([w, n]) => [Number(w), n]).sort((a, b) => b[0] - a[0]);

    resultEl.append(
      el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Per side'),
      el('div', { style: 'font-size:22px;font-weight:800;margin:4px 0 12px' }, `${num(perSide)}${unit}`)
    );
    if (!entries.length) {
      resultEl.append(el('div', { class: 'muted' }, 'No plates needed — just the bar.'));
    } else {
      const list = el('div', { class: 'list' }, entries.map(([w, n]) =>
        el('div', { class: 'card item' }, [
          el('div', { class: 'thumb' }, '⚪'),
          el('div', { class: 'grow' }, [el('div', { class: 'title' }, `${num(w)}${unit} × ${n}`)])
        ])));
      resultEl.append(list);
    }
    if (remainder > 0.001) {
      resultEl.append(el('div', { class: 'dim', style: 'font-size:12px;margin-top:10px' },
        `⚠️ ${num(remainder)}${unit} per side can't be made exactly with these plates.`));
    }
  }

  [targetInput, barInput, platesInput].forEach(i => i.addEventListener('input', recompute));
  recompute();

  openModal(el('div', {}, [
    el('h3', {}, '🏋️ Plate calculator'),
    el('label', {}, [`Target total weight (${unit})`, targetInput]),
    el('label', {}, [`Bar weight (${unit})`, barInput]),
    el('label', {}, [`Available plates (${unit}, comma-separated)`, platesInput]),
    resultEl
  ]));
}
