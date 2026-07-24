// Food view: a reusable food library + a daily log with calorie/macro totals,
// recipes (build-from-foods snapshots), water tracking, and faster-logging
// helpers (copy yesterday, recents-first food picker).
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, num, fmtDate, todayISO, shiftDate, toast, formModal, confirmModal, actionSheet, emptyState,
  skeleton, staggerChildren, countUp, openModal, closeModal
} from './ui.js';
import { lineChart, chartCard } from './charts.js';
import { scanBarcodeModal, lookupBarcode } from './barcode.js';

let selectedDate = todayISO();
const DEFAULT_WATER_GOAL_ML = 2500;
let lastWaterAdd = 0; // resets each renderFood() — powers the water card's Undo button

async function loadData(date) {
  const [foods, logs, settings, water, recentLogs] = await Promise.all([
    sb.from('foods').select('*').order('name'),
    sb.from('food_logs').select('*').eq('log_date', date).order('created_at'),
    sb.from('user_settings').select('calorie_target,water_goal_ml').eq('user_id', getUid()).maybeSingle(),
    sb.from('water_logs').select('amount_ml').eq('user_id', getUid()).eq('log_date', date).maybeSingle(),
    sb.from('food_logs').select('food_id,created_at').order('created_at', { ascending: false }).limit(200)
  ]);
  if (foods.error) throw foods.error;
  if (logs.error) throw logs.error;
  const calorieTarget = settings.error ? null : Number(settings.data?.calorie_target) || null;
  const waterGoalMl = settings.error ? DEFAULT_WATER_GOAL_ML : Number(settings.data?.water_goal_ml) || DEFAULT_WATER_GOAL_ML;
  const waterMl = water.error ? 0 : Number(water.data?.amount_ml) || 0;

  // Rank foods by most-recent-use (recency of appearance in food_logs); foods
  // never logged sort alphabetically after every used food — makes the common
  // case (log the same handful of things most days) a near-top-of-list tap.
  const recencyRank = new Map();
  (recentLogs.data || []).forEach((r, i) => { if (r.food_id && !recencyRank.has(r.food_id)) recencyRank.set(r.food_id, i); });
  const orderedFoods = [...(foods.data || [])].sort((a, b) => {
    const ra = recencyRank.has(a.id) ? recencyRank.get(a.id) : Infinity;
    const rb = recencyRank.has(b.id) ? recencyRank.get(b.id) : Infinity;
    return ra !== rb ? ra - rb : a.name.localeCompare(b.name);
  });

  return { foods: orderedFoods, logs: logs.data || [], calorieTarget, waterMl, waterGoalMl };
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
  const { foods, logs, calorieTarget, waterMl, waterGoalMl } = data;
  lastWaterAdd = 0;
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
  const targetBits = calorieTarget ? [
    el('div', { class: 'dim', style: 'font-size:13px;margin-top:2px' }, `of ${num(calorieTarget)} kcal target`),
    el('div', { class: 'meter', style: 'margin-top:10px' }, [
      el('div', { class: 'meter-fill', style: `width:${Math.min(100, (t.cal / calorieTarget) * 100).toFixed(1)}%` })
    ]),
    el('div', { class: 'dim', style: 'font-size:12px;margin-top:6px' },
      t.cal <= calorieTarget ? `${num(calorieTarget - t.cal)} kcal remaining` : `${num(t.cal - calorieTarget)} kcal over`)
  ] : [];
  root.append(el('div', { class: 'card', style: 'padding:18px;margin-bottom:18px' }, [
    el('div', { style: 'display:flex;align-items:baseline;justify-content:space-between' }, [
      el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Calories'),
      calEl
    ]),
    ...targetBits,
    el('div', { class: 'row', style: 'margin-top:14px' }, [
      macro('Protein', t.p), macro('Carbs', t.c), macro('Fat', t.f)
    ])
  ]));
  countUp(calEl, t.cal, num);

  // Water
  root.append(waterCard(waterMl, waterGoalMl, root));

  // Logged foods
  root.append(el('div', { class: 'section-head' }, [
    el('h2', {}, 'Logged'),
    el('div', { class: 'row', style: 'gap:14px;width:auto' }, [
      el('button', { class: 'link', onClick: () => manageRecipes(root) }, 'Recipes'),
      el('button', { class: 'link', onClick: () => manageFoods(root) }, 'My foods')
    ])
  ]));
  if (!logs.length) {
    root.append(emptyState('🍽️', 'Nothing logged. Tap + to add food.'));
    root.append(el('button', { class: 'btn btn-sm btn-ghost btn-block', style: 'margin-bottom:8px', onClick: () => copyYesterday(root) }, '⏪ Copy yesterday'));
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

  root.append(el('button', { class: 'fab fab-secondary', title: 'Scan barcode', onClick: () => scanAndHandle(root) }, '📷'));
  root.append(el('button', { class: 'fab', title: 'Log food', onClick: () => logFoodForm(foods, root) }, '+'));
}

// Scans a barcode, then: logs instantly if it matches a food already in the
// user's library (barcode remembered from a prior save), else looks it up on
// Open Food Facts and opens the New Food form prefilled — or, on a miss,
// opens it with just the barcode kept so the user can add it manually.
async function scanAndHandle(root) {
  const barcode = await scanBarcodeModal();
  if (!barcode) return;

  const { data: existing } = await sb.from('foods')
    .select('*').eq('user_id', getUid()).eq('barcode', barcode).maybeSingle();
  if (existing) {
    const { error } = await sb.from('food_logs').insert({
      user_id: getUid(), food_id: existing.id, food_name: existing.name,
      log_date: selectedDate, servings: 1,
      calories: existing.calories, protein: existing.protein, carbs: existing.carbs, fat: existing.fat
    });
    if (error) { toast(error.message, 'err'); return; }
    toast(`${existing.name} logged`, 'ok');
    renderFood(root);
    return;
  }

  const hit = await lookupBarcode(barcode);
  if (hit) {
    addFoodForm(root, () => renderFood(root), hit);
  } else {
    toast('Not found on Open Food Facts — add it manually', '');
    addFoodForm(root, () => renderFood(root), { barcode });
  }
}

// ── Water tracking ──
function waterCard(amountMl, goalMl, root) {
  const pct = goalMl ? Math.min(100, (amountMl / goalMl) * 100) : 0;
  const totalEl = el('div', { style: 'font-size:22px;font-weight:800;cursor:pointer' }, `${num(amountMl)} / ${num(goalMl)} ml`);
  totalEl.addEventListener('click', () => editWaterAmount(amountMl, root));
  return el('div', { class: 'card', style: 'padding:16px 18px;margin-bottom:18px' }, [
    el('div', { style: 'display:flex;align-items:baseline;justify-content:space-between' }, [
      el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, '💧 Water'),
      totalEl
    ]),
    el('div', { class: 'meter', style: 'margin-top:10px' }, [el('div', { class: 'meter-fill', style: `width:${pct.toFixed(1)}%` })]),
    el('div', { class: 'row', style: 'margin-top:12px;gap:8px' }, [
      el('button', { class: 'btn btn-sm btn-ghost', onClick: () => addWater(250, root) }, '+250ml'),
      el('button', { class: 'btn btn-sm btn-ghost', onClick: () => addWater(500, root) }, '+500ml'),
      el('button', { class: 'btn btn-sm btn-ghost', disabled: !lastWaterAdd, onClick: () => undoWater(root) }, '↩ Undo'),
      el('button', { class: 'btn btn-sm btn-ghost', onClick: () => editWaterGoal(goalMl, root) }, '🎯')
    ])
  ]);
}

async function upsertWater(nextAmount) {
  const uid = getUid();
  const { data: existing, error: selErr } = await sb.from('water_logs').select('id').eq('user_id', uid).eq('log_date', selectedDate).maybeSingle();
  if (selErr) throw selErr;
  if (existing) {
    const { error } = await sb.from('water_logs').update({ amount_ml: Math.max(0, nextAmount) }).eq('id', existing.id);
    if (error) throw error;
  } else {
    const { error } = await sb.from('water_logs').insert({ user_id: uid, log_date: selectedDate, amount_ml: Math.max(0, nextAmount) });
    if (error) throw error;
  }
}

async function addWater(delta, root) {
  try {
    const { data } = await sb.from('water_logs').select('amount_ml').eq('user_id', getUid()).eq('log_date', selectedDate).maybeSingle();
    const current = Number(data?.amount_ml) || 0;
    await upsertWater(current + delta);
    lastWaterAdd = delta;
    toast(`+${delta}ml water`, 'ok');
    renderFood(root);
  } catch (ex) {
    toast(ex.message || 'Failed to log water', 'err');
  }
}

async function undoWater(root) {
  if (!lastWaterAdd) return;
  try {
    const { data } = await sb.from('water_logs').select('amount_ml').eq('user_id', getUid()).eq('log_date', selectedDate).maybeSingle();
    const current = Number(data?.amount_ml) || 0;
    await upsertWater(current - lastWaterAdd);
    lastWaterAdd = 0;
    toast('Undone', '');
    renderFood(root);
  } catch (ex) {
    toast(ex.message || 'Failed to undo', 'err');
  }
}

function editWaterAmount(current, root) {
  formModal({
    title: 'Set today\'s water',
    fields: [{ name: 'amount_ml', label: 'Amount (ml)', type: 'number', step: '50', min: '0', value: current, required: true }],
    submitText: 'Save',
    onSubmit: async v => {
      await upsertWater(Number(v.amount_ml) || 0);
      lastWaterAdd = 0;
      toast('Water updated', 'ok');
      renderFood(root);
    }
  });
}

function editWaterGoal(current, root) {
  formModal({
    title: 'Daily water goal',
    fields: [{ name: 'goal_ml', label: 'Goal (ml)', type: 'number', step: '50', min: '0', value: current, required: true }],
    submitText: 'Save',
    onSubmit: async v => {
      const { error } = await sb.from('user_settings')
        .upsert({ user_id: getUid(), water_goal_ml: Number(v.goal_ml) || DEFAULT_WATER_GOAL_ML }, { onConflict: 'user_id' });
      if (error) throw error;
      toast('Goal saved', 'ok');
      renderFood(root);
    }
  });
}

// ── Faster logging: copy yesterday's entries into the selected day ──
async function copyYesterday(root) {
  const yesterday = shiftDate(selectedDate, -1);
  const { data, error } = await sb.from('food_logs').select('*').eq('log_date', yesterday);
  if (error) { toast(error.message, 'err'); return; }
  if (!data || !data.length) { toast('No entries yesterday to copy', ''); return; }
  const rows = data.map(l => ({
    user_id: getUid(), food_id: l.food_id, food_name: l.food_name,
    log_date: selectedDate, servings: l.servings,
    calories: l.calories, protein: l.protein, carbs: l.carbs, fat: l.fat
  }));
  const { error: insErr } = await sb.from('food_logs').insert(rows);
  if (insErr) { toast(insErr.message, 'err'); return; }
  toast(`Copied ${rows.length} entr${rows.length === 1 ? 'y' : 'ies'}`, 'ok');
  renderFood(root);
}

// ── Recipes: build from foods, log as one snapshot entry ──
async function manageRecipes(root) {
  const [{ data: recipes, error: rErr }, { data: foods, error: fErr }] = await Promise.all([
    sb.from('recipes').select('*').order('name'),
    sb.from('foods').select('*').order('name')
  ]);
  if (rErr) { toast(rErr.message, 'err'); return; }
  if (fErr) { toast(fErr.message, 'err'); return; }
  actionSheet('Recipes', [
    { label: '＋ New recipe', primary: true, onClick: () => recipeBuilderForm(root, foods || [], null) },
    ...(recipes || []).map(rc => ({
      label: `${rc.name} — ${num(rc.calories)} cal`,
      onClick: () => recipeActions(rc, foods || [], root)
    }))
  ]);
}

function recipeActions(rc, foods, root) {
  actionSheet(rc.name, [
    { label: '📥 Log to today', primary: true, onClick: () => logRecipe(rc, root) },
    { label: '✏️ Edit', onClick: () => recipeBuilderForm(root, foods, rc) },
    { label: '🗑️ Delete', danger: true, onClick: () => {
      confirmModal({
        title: 'Delete recipe?', confirmText: 'Delete',
        onConfirm: async () => {
          const { error } = await sb.from('recipes').delete().eq('id', rc.id);
          if (error) throw error;
          toast('Deleted');
          renderFood(root);
        }
      });
    } }
  ]);
}

async function logRecipe(rc, root) {
  const { error } = await sb.from('food_logs').insert({
    user_id: getUid(), food_id: null, food_name: rc.name,
    log_date: selectedDate, servings: 1,
    calories: rc.calories, protein: rc.protein, carbs: rc.carbs, fat: rc.fat
  });
  if (error) { toast(error.message, 'err'); return; }
  toast(`${rc.name} logged`, 'ok');
  renderFood(root);
}

function recipeBuilderForm(root, foods, existing) {
  if (!foods.length) {
    toast('Add a food to your library first', '');
    return;
  }
  const nameInput = el('input', { value: existing?.name || '', placeholder: 'e.g. Sunday fry-up', style: 'margin-top:0' });
  const itemsWrap = el('div', { style: 'margin-top:10px' });
  const items = []; // [{ foodSelect, servingsInput, food }]
  const totalsEl = el('div', { style: 'margin-top:14px;font-size:14px;font-weight:700' });
  const err = el('p', { class: 'form-error', hidden: true });

  function recompute() {
    let cal = 0, p = 0, c = 0, f = 0;
    for (const it of items) {
      const food = foods.find(fd => fd.id === it.foodSelect.value);
      const s = Number(it.servingsInput.value) || 0;
      if (food) { cal += food.calories * s; p += food.protein * s; c += food.carbs * s; f += food.fat * s; }
    }
    totalsEl.textContent = `${num(cal)} cal · P ${num(p)} · C ${num(c)} · F ${num(f)}`;
    return { cal, p, c, f };
  }

  function addItemRow(foodId, servings) {
    const foodSelect = el('select', { style: 'margin-top:0' }, foods.map(fd => el('option', { value: fd.id }, `${fd.name} (${num(fd.calories)} cal)`)));
    if (foodId) foodSelect.value = foodId;
    const servingsInput = el('input', { type: 'number', step: '0.25', min: '0', value: servings ?? 1, style: 'margin-top:0;width:80px' });
    const removeBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => { row.remove(); items.splice(items.indexOf(entry), 1); recompute(); } }, '✕');
    const row = el('div', { class: 'row', style: 'gap:8px;align-items:center;margin-bottom:8px' }, [foodSelect, servingsInput, removeBtn]);
    foodSelect.addEventListener('change', recompute);
    servingsInput.addEventListener('input', recompute);
    const entry = { foodSelect, servingsInput };
    items.push(entry);
    itemsWrap.append(row);
    recompute();
  }

  if (existing?.items?.length) {
    for (const it of existing.items) addItemRow(it.food_id, it.servings);
  } else {
    addItemRow();
  }

  const addRowBtn = el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => addItemRow() }, '＋ Add item');
  const saveBtn = el('button', { type: 'button', class: 'btn btn-primary btn-block', style: 'margin-top:14px' }, existing ? 'Save changes' : 'Save recipe');

  saveBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) { err.textContent = 'Name your recipe.'; err.hidden = false; return; }
    const validItems = items.filter(it => foods.find(fd => fd.id === it.foodSelect.value) && Number(it.servingsInput.value) > 0);
    if (!validItems.length) { err.textContent = 'Add at least one item with servings.'; err.hidden = false; return; }
    const totals = recompute();
    const payload = {
      user_id: getUid(), name,
      items: validItems.map(it => {
        const food = foods.find(fd => fd.id === it.foodSelect.value);
        return { food_id: food.id, food_name: food.name, servings: Number(it.servingsInput.value) };
      }),
      calories: totals.cal, protein: totals.p, carbs: totals.c, fat: totals.f
    };
    saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      const { error } = existing
        ? await sb.from('recipes').update(payload).eq('id', existing.id)
        : await sb.from('recipes').insert(payload);
      if (error) throw error;
      toast('Recipe saved', 'ok');
      closeModal();
      manageRecipes(root);
    } catch (ex) {
      err.textContent = ex.message || 'Failed to save.';
      err.hidden = false; saveBtn.disabled = false; saveBtn.textContent = existing ? 'Save changes' : 'Save recipe';
    }
  });

  openModal(el('div', {}, [
    el('h3', {}, existing ? 'Edit recipe' : 'New recipe'),
    el('label', {}, ['Recipe name', nameInput]),
    itemsWrap, addRowBtn, totalsEl, err, saveBtn
  ]));
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
      { label: '📷 Scan a barcode', primary: true, onClick: () => scanAndHandle(root) },
      { label: '＋ Add a food first', onClick: () => addFoodForm(root, () => renderFood(root)) }
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

function addFoodForm(root, after, prefill = {}) {
  formModal({
    title: prefill.barcode && !prefill.name ? 'New food (barcode not found — add manually)' : 'New food',
    fields: foodFields(prefill),
    submitText: 'Save food',
    onSubmit: async v => {
      const payload = { ...v, user_id: getUid() };
      if (prefill.barcode) payload.barcode = prefill.barcode;
      const { error } = await sb.from('foods').insert(payload);
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
