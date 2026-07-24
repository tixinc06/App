// TDEE weight-goal planner: Mifflin-St Jeor maintenance calories, then a
// selectable deficit/surplus toward a goal weight, with a projected ETA.
// The resulting daily target is saved to user_settings.calorie_target, which
// js/food.js reads to show a "cal / target" progress ring.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, num, toast, emptyState, skeleton } from './ui.js';
import { weightUnit, kgToDisplay, displayToKg, fmtWeight, weightStep } from './units.js';

const KCAL_PER_KG = 7700; // ~3,500 kcal/lb, the standard rough conversion
export const AGGRESSIVENESS_OPTIONS = [300, 500, 750];

export const ACTIVITY_LEVELS = [
  { value: 1.2, label: 'Sedentary — little or no exercise' },
  { value: 1.375, label: 'Light — exercise 1-3 days/week' },
  { value: 1.55, label: 'Moderate — exercise 3-5 days/week' },
  { value: 1.725, label: 'Active — exercise 6-7 days/week' },
  { value: 1.9, label: 'Very active — physical job or 2x/day training' }
];

// Mifflin-St Jeor: the standard, widely-used BMR estimate (same "estimated,
// not exact" caveat as the e1RM formula elsewhere in the app).
export function bmr({ weightKg, heightCm, age, sex }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}

export function maintenanceCalories(stats) {
  return Math.round(bmr(stats) * (stats.activityLevel || 1.2));
}

// direction: 'lose' | 'gain' | 'maintain'. dailyDelta is always positive —
// the caller applies it as -delta for a deficit, +delta for a surplus.
export function computePlan({ maintenance, currentWeight, goalWeight, dailyDelta }) {
  const diff = goalWeight - currentWeight;
  const direction = Math.abs(diff) < 0.1 ? 'maintain' : diff < 0 ? 'lose' : 'gain';
  const target = direction === 'lose' ? maintenance - dailyDelta
    : direction === 'gain' ? maintenance + dailyDelta
    : maintenance;
  let etaWeeks = null;
  if (direction !== 'maintain' && dailyDelta > 0) {
    const kcalNeeded = Math.abs(diff) * KCAL_PER_KG;
    etaWeeks = Math.ceil(kcalNeeded / dailyDelta / 7);
  }
  return { direction, target: Math.max(1000, Math.round(target)), etaWeeks };
}

async function loadPlannerState() {
  const uid = getUid();
  const [{ data: settings, error: sErr }, { data: weights, error: wErr }] = await Promise.all([
    sb.from('user_settings').select('*').eq('user_id', uid).maybeSingle(),
    sb.from('weight_entries').select('weight').order('entry_date', { ascending: false }).limit(1)
  ]);
  if (sErr) throw sErr;
  if (wErr) throw wErr;
  return { settings: settings || {}, currentWeight: weights?.[0]?.weight ? Number(weights[0].weight) : null };
}

export async function renderWeightPlanner(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'));
  let state;
  try {
    state = await loadPlannerState();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load the planner. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  if (state.currentWeight == null) {
    container.append(emptyState('⚖️', 'Log a bodyweight entry first (Fitness → Train) so the planner has a starting point.'));
    return;
  }

  const s = state.settings;
  const heightInput = el('input', { type: 'number', inputmode: 'decimal', step: '0.5', min: '0', placeholder: 'cm', value: s.height_cm ?? '' });
  const ageInput = el('input', { type: 'number', inputmode: 'numeric', step: '1', min: '10', max: '100', placeholder: 'years', value: s.age ?? '' });
  const sexSelect = el('select', {}, [
    el('option', { value: 'male', selected: s.sex !== 'female' }, 'Male'),
    el('option', { value: 'female', selected: s.sex === 'female' }, 'Female')
  ]);
  const activitySelect = el('select', {}, ACTIVITY_LEVELS.map(a =>
    el('option', { value: a.value, selected: Number(s.activity_level) === a.value }, a.label)));
  const goalInput = el('input', {
    type: 'number', inputmode: 'decimal', step: String(weightStep()), min: '0', placeholder: weightUnit(),
    value: s.goal_weight != null ? kgToDisplay(s.goal_weight) : ''
  });

  let dailyDelta = 500;
  const deltaButtons = {};
  const deltaRow = el('div', { class: 'row', style: 'gap:8px;margin-top:8px' },
    AGGRESSIVENESS_OPTIONS.map(v => {
      const btn = el('button', {
        type: 'button', class: 'btn btn-sm ' + (v === dailyDelta ? 'btn-primary' : 'btn-ghost'),
        onClick: () => { dailyDelta = v; for (const [k, b] of Object.entries(deltaButtons)) b.className = 'btn btn-sm ' + (Number(k) === v ? 'btn-primary' : 'btn-ghost'); recompute(); }
      }, `±${v} kcal`);
      deltaButtons[v] = btn;
      return btn;
    }));

  const resultCard = el('div', { class: 'card', style: 'padding:16px 18px;margin-top:16px' });
  const err = el('p', { class: 'form-error', hidden: true });
  const saveBtn = el('button', { class: 'btn btn-primary btn-block', style: 'margin-top:14px' }, 'Save plan');

  function currentInputs() {
    return {
      heightCm: Number(heightInput.value) || 0,
      age: Number(ageInput.value) || 0,
      sex: sexSelect.value,
      activityLevel: Number(activitySelect.value),
      goalWeight: goalInput.value !== '' ? displayToKg(goalInput.value) : state.currentWeight
    };
  }

  function recompute() {
    const v = currentInputs();
    resultCard.innerHTML = '';
    if (!v.heightCm || !v.age) {
      resultCard.append(el('div', { class: 'muted' }, 'Enter your height and age to see your numbers.'));
      return;
    }
    const maintenance = maintenanceCalories({ weightKg: state.currentWeight, heightCm: v.heightCm, age: v.age, sex: v.sex, activityLevel: v.activityLevel });
    const plan = computePlan({ maintenance, currentWeight: state.currentWeight, goalWeight: v.goalWeight, dailyDelta });

    const dirLabel = plan.direction === 'lose' ? `${num(dailyDelta)} kcal deficit`
      : plan.direction === 'gain' ? `${num(dailyDelta)} kcal surplus`
      : 'Maintenance';

    resultCard.append(
      el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Maintenance (TDEE)'),
      el('div', { style: 'font-size:22px;font-weight:800;margin:4px 0 14px' }, `${num(maintenance)} kcal`),
      el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Your daily target'),
      el('div', { style: 'font-size:28px;font-weight:800;margin:4px 0 4px;color:var(--primary-soft)' }, `${num(plan.target)} kcal`),
      el('div', { class: 'dim', style: 'font-size:13px' }, dirLabel),
      plan.etaWeeks
        ? el('div', { style: 'margin-top:14px;font-size:14px' }, `📅 ~${plan.etaWeeks} week${plan.etaWeeks === 1 ? '' : 's'} to reach ${fmtWeight(v.goalWeight)} at this pace`)
        : null
    );
  }
  [heightInput, ageInput, goalInput].forEach(i => i.addEventListener('input', recompute));
  sexSelect.addEventListener('change', recompute);
  activitySelect.addEventListener('change', recompute);
  recompute();

  saveBtn.addEventListener('click', async () => {
    const v = currentInputs();
    if (!v.heightCm || !v.age) { err.textContent = 'Enter your height and age.'; err.hidden = false; return; }
    err.hidden = true; saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      const maintenance = maintenanceCalories({ weightKg: state.currentWeight, heightCm: v.heightCm, age: v.age, sex: v.sex, activityLevel: v.activityLevel });
      const plan = computePlan({ maintenance, currentWeight: state.currentWeight, goalWeight: v.goalWeight, dailyDelta });
      const { error } = await sb.from('user_settings').upsert({
        user_id: getUid(), height_cm: v.heightCm, age: v.age, sex: v.sex,
        activity_level: v.activityLevel, goal_weight: v.goalWeight, calorie_target: plan.target
      }, { onConflict: 'user_id' });
      if (error) throw error;
      toast('Plan saved — Food will show your target', 'ok');
      saveBtn.textContent = 'Save plan';
      saveBtn.disabled = false;
    } catch (ex) {
      err.textContent = ex.message || 'Failed to save.';
      err.hidden = false; saveBtn.disabled = false; saveBtn.textContent = 'Save plan';
    }
  });

  container.append(
    el('div', { class: 'card', style: 'padding:16px 18px' }, [
      el('div', { class: 'dim', style: 'font-size:13px;margin-bottom:12px' }, `Using your latest bodyweight: ${fmtWeight(state.currentWeight)}`),
      el('label', {}, ['Height (cm)', heightInput]),
      el('label', {}, ['Age', ageInput]),
      el('label', {}, ['Sex', sexSelect]),
      el('label', {}, ['Activity level', activitySelect]),
      el('label', {}, [`Goal weight (${weightUnit()})`, goalInput]),
      el('div', { class: 'k', style: 'font-size:11px;color:var(--muted);font-weight:700;text-transform:uppercase;margin-top:12px' }, 'Pace'),
      deltaRow
    ]),
    resultCard,
    err,
    saveBtn
  );
}
