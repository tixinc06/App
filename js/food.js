// Food view: a reusable food library + a daily log with calorie/macro totals.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, num, fmtDate, todayISO, shiftDate, toast, formModal, confirmModal, actionSheet, emptyState,
  skeleton, staggerChildren, countUp
} from './ui.js';
import { lineChart, chartCard } from './charts.js';

let selectedDate = todayISO();

async function loadData(date) {
  const [foods, logs] = await Promise.all([
    sb.from('foods').select('*').order('name'),
    sb.from('food_logs').select('*').eq('log_date', date).order('created_at')
  ]);
  if (foods.error) throw foods.error;
  if (logs.error) throw logs.error;
  return { foods: foods.data || [], logs: logs.data || [] };
}

// Sum calories per day for the last `days` days → continuous series (zeros for gaps).
async function loadCalorieTrend(days) {
  const start = shiftDate(todayISO(), -(days - 1));
  const { data, error } = await sb.from('food_logs').select('log_date,calories').gte('log_date', start);
  if (error || !data) return [];
  const map = {};
  for (const r of data) map[r.log_date] = (map[r.log_date] || 0) + (+r.calories || 0);
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = shiftDate(start, i);
    out.push({ t: d, v: map[d] || 0 });
  }
  return out;
}

export async function renderFood(root) {
  root.innerHTML = '';
  root.append(skeleton(1, 'block'), skeleton(4, 'item'));
  let data;
  try {
    data = await loadData(selectedDate);
  } catch (ex) {
    root.innerHTML = '';
    root.append(emptyState('⚠️', 'Could not load data. ' + (ex.message || '')));
    return;
  }
  const { foods, logs } = data;
  root.innerHTML = '';

  // Date navigator
  root.append(el('div', { class: 'section-head' }, [
    el('button', { class: 'btn btn-sm btn-ghost', onClick: () => { selectedDate = shiftDate(selectedDate, -1); renderFood(root); } }, '‹'),
    el('h2', { style: 'text-transform:none;letter-spacing:0;font-size:16px' },
      selectedDate === todayISO() ? 'Today' : fmtDate(selectedDate)),
    el('button', {
      class: 'btn btn-sm btn-ghost',
      disabled: selectedDate >= todayISO(),
      onClick: () => { selectedDate = shiftDate(selectedDate, 1); renderFood(root); }
    }, '›')
  ]));

  // Totals
  const t = logs.reduce((a, l) => ({
    cal: a.cal + (+l.calories || 0), p: a.p + (+l.protein || 0),
    c: a.c + (+l.carbs || 0), f: a.f + (+l.fat || 0)
  }), { cal: 0, p: 0, c: 0, f: 0 });

  const calEl = el('div', { style: 'font-size:28px;font-weight:800' });
  root.append(el('div', { class: 'card', style: 'padding:18px;margin-bottom:18px' }, [
    el('div', { style: 'display:flex;align-items:baseline;justify-content:space-between' }, [
      el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Calories'),
      calEl
    ]),
    el('div', { class: 'row', style: 'margin-top:14px' }, [
      macro('Protein', t.p), macro('Carbs', t.c), macro('Fat', t.f)
    ])
  ]));
  countUp(calEl, t.cal, num);

  // Logged foods
  root.append(el('div', { class: 'section-head' }, [
    el('h2', {}, 'Logged'),
    el('button', { class: 'link', onClick: () => manageFoods(root) }, 'My foods')
  ]));
  if (!logs.length) {
    root.append(emptyState('🍽️', 'Nothing logged. Tap + to add food.'));
  } else {
    const logList = el('div', { class: 'list' }, logs.map(l => logRow(l, root)));
    staggerChildren(logList);
    root.append(logList);
  }

  // ── Insights: calorie trend (last 14 days) ──
  const trend = await loadCalorieTrend(14);
  if (trend.some(d => d.v > 0)) {
    root.append(el('div', { class: 'section-head', style: 'margin-top:22px' }, [el('h2', {}, 'Insights')]));
    root.append(chartCard('Calories · last 14 days', lineChart(trend, { color: 'var(--amber)', fmt: v => num(v) })));
  }

  root.append(el('button', { class: 'fab', title: 'Log food', onClick: () => logFoodForm(foods, root) }, '+'));
}

function macro(label, val) {
  return el('div', { style: 'text-align:center' }, [
    el('div', { style: 'font-size:18px;font-weight:800' }, num(val) + 'g'),
    el('div', { class: 'dim', style: 'font-size:12px;margin-top:2px' }, label)
  ]);
}

function logRow(l, root) {
  return el('div', { class: 'card item', onClick: () => logActions(l, root) }, [
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, l.food_name || 'Food'),
      el('div', { class: 'sub' }, `${num(l.servings)} serving${l.servings == 1 ? '' : 's'} · P ${num(l.protein)} · C ${num(l.carbs)} · F ${num(l.fat)}`)
    ]),
    el('div', { class: 'amt' }, num(l.calories))
  ]);
}

function logActions(l, root) {
  actionSheet(l.food_name || 'Entry', [
    { label: '🗑️ Remove', danger: true, onClick: () => {
      confirmModal({
        title: 'Remove entry?', confirmText: 'Remove',
        onConfirm: async () => {
          const { error } = await sb.from('food_logs').delete().eq('id', l.id);
          if (error) throw error;
          renderFood(root);
        }
      });
    } }
  ]);
}

// ── Log a food for the selected day ──
function logFoodForm(foods, root) {
  if (!foods.length) {
    actionSheet('No foods yet', [
      { label: '＋ Add a food first', primary: true, onClick: () => addFoodForm(root, () => renderFood(root)) }
    ]);
    return;
  }
  formModal({
    title: 'Log food',
    fields: [
      { name: 'food_id', label: 'Food', type: 'select', options: foods.map(f => ({ value: f.id, label: `${f.name} (${num(f.calories)} cal)` })) },
      { name: 'servings', label: 'Servings', type: 'number', step: '0.25', min: '0', value: 1, required: true }
    ],
    submitText: 'Add to day',
    onSubmit: async v => {
      const food = foods.find(f => f.id === v.food_id);
      if (!food) throw new Error('Pick a food.');
      const s = Number(v.servings) || 1;
      const { error } = await sb.from('food_logs').insert({
        user_id: getUid(), food_id: food.id, food_name: food.name,
        log_date: selectedDate, servings: s,
        calories: food.calories * s, protein: food.protein * s,
        carbs: food.carbs * s, fat: food.fat * s
      });
      if (error) throw error;
      toast('Logged', 'ok');
      renderFood(root);
    }
  });
}

// ── Manage the food library ──
async function manageFoods(root) {
  const { data, error } = await sb.from('foods').select('*').order('name');
  if (error) { toast(error.message, 'err'); return; }
  const foods = data || [];
  actionSheet('My foods', [
    { label: '＋ New food', primary: true, onClick: () => addFoodForm(root, () => manageFoods(root)) },
    ...foods.map(f => ({ label: `${f.name} — ${num(f.calories)} cal`, onClick: () => foodActions(f, root) }))
  ]);
}

function foodActions(f, root) {
  actionSheet(f.name, [
    { label: '✏️ Edit', onClick: () => editFoodForm(f, root) },
    { label: '🗑️ Delete', danger: true, onClick: () => {
      confirmModal({
        title: 'Delete food?',
        message: 'Removes it from your library. Past log entries are kept.',
        confirmText: 'Delete',
        onConfirm: async () => {
          const { error } = await sb.from('foods').delete().eq('id', f.id);
          if (error) throw error;
          toast('Deleted');
          renderFood(root);
        }
      });
    } }
  ]);
}

const foodFields = (v = {}) => ([
  { name: 'name', label: 'Food name', required: true, value: v.name, placeholder: 'e.g. Chicken breast 100g' },
  { name: 'serving_desc', label: 'Serving description', value: v.serving_desc, placeholder: '100g, 1 cup…' },
  { name: 'calories', label: 'Calories (per serving)', type: 'number', step: '1', min: '0', required: true, value: v.calories },
  { name: 'protein', label: 'Protein (g)', type: 'number', step: '0.1', min: '0', value: v.protein ?? 0 },
  { name: 'carbs', label: 'Carbs (g)', type: 'number', step: '0.1', min: '0', value: v.carbs ?? 0 },
  { name: 'fat', label: 'Fat (g)', type: 'number', step: '0.1', min: '0', value: v.fat ?? 0 }
]);

function addFoodForm(root, after) {
  formModal({
    title: 'New food',
    fields: foodFields(),
    submitText: 'Save food',
    onSubmit: async v => {
      const { error } = await sb.from('foods').insert({ ...v, user_id: getUid() });
      if (error) throw error;
      toast('Food saved', 'ok');
      (after || (() => renderFood(root)))();
    }
  });
}

function editFoodForm(f, root) {
  formModal({
    title: 'Edit food',
    fields: foodFields(f),
    submitText: 'Save',
    onSubmit: async v => {
      const { error } = await sb.from('foods').update(v).eq('id', f.id);
      if (error) throw error;
      toast('Saved', 'ok');
      renderFood(root);
    }
  });
}
