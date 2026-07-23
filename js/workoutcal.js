// Workout history calendar: a month grid (reusing the .cal-* layout from
// js/calendar.js's money calendar) where each trained day shows the
// workout's name, colour-coded by an inferred type (Push/Pull/Legs/Upper/
// Lower/etc. — keyword-matched against the name; no schema change). Tapping
// a day opens the existing workout detail modal (js/fitness.js's
// viewWorkout, exported for reuse here).
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, fmtDate, todayISO, isoOf, actionSheet, emptyState, skeleton, staggerChildren } from './ui.js';
import { viewWorkout } from './fitness.js';

const TYPE_RULES = [
  { key: 'push', label: 'Push', color: '#ff5470' },
  { key: 'pull', label: 'Pull', color: '#3fb6f0' },
  { key: 'leg', label: 'Legs', color: '#22d99a' },
  { key: 'upper', label: 'Upper', color: '#ffb341' },
  { key: 'lower', label: 'Lower', color: '#9b8dff' },
  { key: 'full', label: 'Full body', color: '#6d5efc' },
  { key: 'cardio|run|cycl', label: 'Cardio', color: '#3fb6f0' },
  { key: 'arm', label: 'Arms', color: '#ff8a3d' },
  { key: 'chest', label: 'Chest', color: '#ff5470' },
  { key: 'back', label: 'Back', color: '#22d99a' },
  { key: 'shoulder', label: 'Shoulders', color: '#9b8dff' }
];
const OTHER_TYPE = { key: 'other', label: 'Workout', color: 'var(--muted-dim)' };

function typeOf(name) {
  const n = (name || '').toLowerCase();
  for (const r of TYPE_RULES) {
    if (new RegExp(r.key).test(n)) return r;
  }
  return OTHER_TYPE;
}

async function loadWorkouts() {
  const { data, error } = await sb.from('workouts').select('*').eq('user_id', getUid()).order('workout_date', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function renderWorkoutCalendar(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'));
  let workouts;
  try {
    workouts = await loadWorkouts();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load workout history. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  if (!workouts.length) {
    container.append(emptyState('📅', 'No workouts logged yet.'));
    return;
  }

  const byDate = {};
  for (const w of workouts) (byDate[w.workout_date] ||= []).push(w);

  const usedTypes = new Map();
  for (const w of workouts) {
    const t = typeOf(w.name);
    if (!usedTypes.has(t.key)) usedTypes.set(t.key, t);
  }

  const now = new Date();
  let year = now.getFullYear(), month = now.getMonth();

  const card = el('div', { class: 'card cal-card' });
  const legend = el('div', { class: 'workoutcal-legend' },
    [...usedTypes.values()].map(t => el('div', { class: 'workoutcal-legend-item' }, [
      el('span', { class: 'workoutcal-dot', style: `background:${t.color}` }), t.label
    ])));
  container.append(card, legend);

  function render() {
    card.innerHTML = '';
    const monthStart = new Date(year, month, 1);
    card.append(
      el('div', { class: 'cal-nav' }, [
        el('button', { class: 'btn btn-sm btn-ghost', onClick: () => { month--; if (month < 0) { month = 11; year--; } render(); } }, '‹'),
        el('div', { class: 'month-label' }, monthStart.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })),
        el('button', { class: 'btn btn-sm btn-ghost', onClick: () => { month++; if (month > 11) { month = 0; year++; } render(); } }, '›')
      ]),
      grid()
    );
  }

  function grid() {
    const g = el('div', { class: 'cal-grid' });
    for (const d of ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']) g.append(el('div', { class: 'cal-dow' }, d));

    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrev = new Date(year, month, 0).getDate();
    const today = todayISO();
    const cellsNeeded = Math.ceil((firstDow + daysInMonth) / 7) * 7;

    for (let i = 0; i < cellsNeeded; i++) {
      const dayNum = i - firstDow + 1;
      let cellDate, otherMonth = false, label;
      if (dayNum < 1) {
        cellDate = new Date(year, month - 1, daysInPrev + dayNum);
        otherMonth = true; label = daysInPrev + dayNum;
      } else if (dayNum > daysInMonth) {
        cellDate = new Date(year, month + 1, dayNum - daysInMonth);
        otherMonth = true; label = dayNum - daysInMonth;
      } else {
        cellDate = new Date(year, month, dayNum);
        label = dayNum;
      }
      const iso = isoOf(cellDate);
      const dayWorkouts = byDate[iso];
      const cls = ['cal-day'];
      if (otherMonth) cls.push('other-month');
      if (iso === today) cls.push('today');
      if (dayWorkouts?.length) cls.push('has-sales');

      const cell = el('div', {
        class: cls.join(' '),
        onClick: dayWorkouts?.length && !otherMonth ? () => openDay(iso, dayWorkouts, root) : null
      }, [
        el('div', { class: 'd-num' }, String(label)),
        dayWorkouts?.length ? el('div', { class: 'workoutcal-dot', style: `background:${typeOf(dayWorkouts[0].name).color};margin:2px auto 0` }) : null,
        dayWorkouts?.length ? el('div', { class: 'workoutcal-name' }, dayWorkouts[0].name || 'Workout') : null,
        dayWorkouts?.length > 1 ? el('div', { class: 'd-cnt' }, `${dayWorkouts.length}`) : null
      ]);
      g.append(cell);
    }
    staggerChildren(g, 20);
    return g;
  }

  render();
}

function openDay(iso, dayWorkouts, root) {
  if (dayWorkouts.length === 1) { viewWorkout(dayWorkouts[0], root); return; }
  actionSheet(fmtDate(iso), dayWorkouts.map(w => ({ label: w.name || 'Workout', onClick: () => viewWorkout(w, root) })));
}
