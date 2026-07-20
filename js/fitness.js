// Fitness view: workout logging (exercises + sets) and bodyweight tracking.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, num, fmtDate, todayISO, isoOf, toast, formModal, confirmModal, actionSheet,
  emptyState, openModal, closeModal, skeleton, staggerChildren, countUp
} from './ui.js';
import { lineChart, barChart, chartCard } from './charts.js';

async function loadData() {
  const [workouts, weights] = await Promise.all([
    sb.from('workouts').select('*').order('workout_date', { ascending: false }).limit(50),
    sb.from('weight_entries').select('*').order('entry_date', { ascending: false }).limit(50)
  ]);
  if (workouts.error) throw workouts.error;
  if (weights.error) throw weights.error;
  return { workouts: workouts.data || [], weights: weights.data || [] };
}

// Count workouts per week (Monday-based) for the last `weeks` weeks, oldest→newest.
function weeklyCounts(workouts, weeks) {
  const d0 = new Date(todayISO() + 'T00:00:00');
  const dow = (d0.getDay() + 6) % 7; // 0 = Monday
  const monday = new Date(d0); monday.setDate(d0.getDate() - dow);
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const ws = new Date(monday); ws.setDate(monday.getDate() - i * 7);
    const startISO = isoOf(ws);
    buckets.push({ label: fmtDate(startISO), start: startISO, value: 0 });
  }
  for (const w of workouts) {
    if (!w.workout_date) continue;
    for (let j = buckets.length - 1; j >= 0; j--) {
      if (w.workout_date >= buckets[j].start) { buckets[j].value++; break; }
    }
  }
  return buckets;
}

export async function renderFitness(root) {
  root.innerHTML = '';
  root.append(skeleton(1, 'block'), skeleton(4, 'item'));
  let data;
  try {
    data = await loadData();
  } catch (ex) {
    root.innerHTML = '';
    root.append(emptyState('⚠️', 'Could not load data. ' + (ex.message || '')));
    return;
  }
  const { workouts, weights } = data;
  root.innerHTML = '';

  // ── Bodyweight card ──
  const latest = weights[0];
  const prev = weights[1];
  const delta = latest && prev ? Number(latest.weight) - Number(prev.weight) : null;
  const weightNumEl = el('span', {}, latest ? '' : '—');
  root.append(el('div', { class: 'card', style: 'padding:18px;margin-bottom:20px' }, [
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between' }, [
      el('div', {}, [
        el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Bodyweight'),
        el('div', { style: 'font-size:28px;font-weight:800;margin-top:4px' }, [
          weightNumEl,
          (latest && delta != null) ? el('span', {}, ` ${delta >= 0 ? '▲' : '▼'} ${num(Math.abs(delta))}`) : null
        ])
      ]),
      el('button', { class: 'btn btn-sm btn-primary', onClick: () => addWeightForm(root) }, '＋ Log')
    ]),
    weights.length ? el('div', { class: 'dim', style: 'font-size:12px;margin-top:8px' },
      'Last: ' + fmtDate(latest.entry_date)) : null
  ]));
  if (latest) countUp(weightNumEl, Number(latest.weight), num);

  if (weights.length > 1) {
    root.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Weight history')]));
    const weightList = el('div', { class: 'list', style: 'margin-bottom:22px' },
      weights.slice(0, 8).map(w =>
        el('div', { class: 'card item', onClick: () => weightActions(w, root) }, [
          el('div', { class: 'grow' }, [el('div', { class: 'title' }, num(w.weight))]),
          el('div', { class: 'sub' }, fmtDate(w.entry_date))
        ])));
    staggerChildren(weightList);
    root.append(weightList);
  }

  // ── Bodyweight trend ──
  if (weights.length >= 2) {
    const series = [...weights].reverse().map(w => ({ t: w.entry_date, v: +w.weight }));
    root.append(chartCard('Bodyweight trend', lineChart(series, { color: 'var(--blue)', fmt: v => num(v) })));
  }

  // ── Workouts ──
  root.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Workouts')]));
  if (!workouts.length) {
    root.append(emptyState('💪', 'No workouts yet. Tap + to log one.'));
  } else {
    const workoutList = el('div', { class: 'list' }, workouts.map(w => workoutRow(w, root)));
    staggerChildren(workoutList);
    root.append(workoutList);

    const bars = weeklyCounts(workouts, 8);
    if (bars.some(b => b.value > 0)) {
      root.append(el('div', { class: 'section-head', style: 'margin-top:20px' }, [el('h2', {}, 'Insights')]));
      root.append(chartCard('Workouts · per week', barChart(bars, { color: 'var(--upper, var(--primary-soft))', fmt: v => String(v) })));
    }
  }

  root.append(el('button', { class: 'fab', title: 'Log workout', onClick: () => workoutBuilder(root) }, '+'));
}

function workoutRow(w, root) {
  const exs = Array.isArray(w.exercises) ? w.exercises : [];
  const setCount = exs.reduce((a, e) => a + (e.sets?.length || 0), 0);
  return el('div', { class: 'card item', onClick: () => viewWorkout(w, root) }, [
    el('div', { class: 'thumb' }, '🏋️'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, w.name || 'Workout'),
      el('div', { class: 'sub' }, `${fmtDate(w.workout_date)} · ${exs.length} exercise${exs.length === 1 ? '' : 's'} · ${setCount} sets`)
    ])
  ]);
}

function viewWorkout(w, root) {
  const exs = Array.isArray(w.exercises) ? w.exercises : [];
  const body = exs.length ? exs.map(e =>
    el('div', { style: 'margin-bottom:12px' }, [
      el('div', { style: 'font-weight:700;margin-bottom:4px' }, e.name || 'Exercise'),
      el('div', { class: 'muted', style: 'font-size:14px' },
        (e.sets || []).map(s => `${num(s.weight)}×${num(s.reps)}`).join('   ') || 'No sets')
    ])) : [el('p', { class: 'muted' }, 'No exercises recorded.')];

  openModal(el('div', {}, [
    el('h3', {}, w.name || 'Workout'),
    el('div', { class: 'dim', style: 'margin-bottom:14px' }, fmtDate(w.workout_date)),
    ...body,
    w.notes ? el('p', { class: 'muted', style: 'margin-top:8px' }, w.notes) : null,
    el('div', { class: 'modal-actions', style: 'margin-top:18px' }, [
      el('button', { class: 'btn btn-ghost', onClick: closeModal }, 'Close'),
      el('button', {
        class: 'btn btn-danger',
        onClick: () => { closeModal(); deleteWorkout(w, root); }
      }, 'Delete')
    ])
  ]));
}

function deleteWorkout(w, root) {
  confirmModal({
    title: 'Delete workout?', confirmText: 'Delete',
    onConfirm: async () => {
      const { error } = await sb.from('workouts').delete().eq('id', w.id);
      if (error) throw error;
      toast('Deleted');
      renderFitness(root);
    }
  });
}

// ── Bodyweight forms ──
function addWeightForm(root) {
  formModal({
    title: 'Log bodyweight',
    fields: [
      { name: 'weight', label: 'Weight', type: 'number', step: '0.1', min: '0', required: true },
      { name: 'entry_date', label: 'Date', type: 'date', value: todayISO() }
    ],
    submitText: 'Save',
    onSubmit: async v => {
      const { error } = await sb.from('weight_entries').insert({ ...v, user_id: getUid() });
      if (error) throw error;
      toast('Logged', 'ok');
      renderFitness(root);
    }
  });
}

function weightActions(w, root) {
  actionSheet(num(w.weight) + ' · ' + fmtDate(w.entry_date), [
    { label: '🗑️ Delete', danger: true, onClick: () => {
      confirmModal({
        title: 'Delete entry?', confirmText: 'Delete',
        onConfirm: async () => {
          const { error } = await sb.from('weight_entries').delete().eq('id', w.id);
          if (error) throw error;
          renderFitness(root);
        }
      });
    } }
  ]);
}

// ── Workout builder (custom modal with dynamic exercises + sets) ──
function workoutBuilder(root) {
  const exWrap = el('div');
  const state = []; // [{ nameInput, sets: [{weightInput, repsInput}] , node }]

  function addExercise() {
    const setsWrap = el('div', { style: 'margin:8px 0 0' });
    const sets = [];
    const nameInput = el('input', { placeholder: 'Exercise name', style: 'margin-top:0' });

    function addSet(weight = '', reps = '') {
      const wI = el('input', { type: 'number', inputmode: 'decimal', step: '0.5', placeholder: 'kg', value: weight, style: 'margin-top:0' });
      const rI = el('input', { type: 'number', inputmode: 'numeric', step: '1', placeholder: 'reps', value: reps, style: 'margin-top:0' });
      const rowObj = { weightInput: wI, repsInput: rI };
      const row = el('div', { class: 'row', style: 'margin-bottom:8px;align-items:center' }, [
        wI, rI,
        el('button', {
          type: 'button', class: 'btn btn-sm btn-ghost', style: 'flex:0 0 auto',
          onClick: () => { const i = sets.indexOf(rowObj); if (i > -1) sets.splice(i, 1); row.remove(); }
        }, '✕')
      ]);
      sets.push(rowObj);
      setsWrap.append(row);
    }
    addSet();

    const exObj = { nameInput, sets };
    const node = el('div', { class: 'card', style: 'padding:14px;margin-bottom:12px' }, [
      el('div', { class: 'row', style: 'align-items:center' }, [
        nameInput,
        el('button', {
          type: 'button', class: 'btn btn-sm btn-danger', style: 'flex:0 0 auto',
          onClick: () => { const i = state.indexOf(exObj); if (i > -1) state.splice(i, 1); node.remove(); }
        }, '🗑')
      ]),
      setsWrap,
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => addSet() }, '＋ Add set')
    ]);
    state.push(exObj);
    exWrap.append(node);
  }
  addExercise();

  const dateInput = el('input', { type: 'date', value: todayISO(), style: 'margin-top:0' });
  const nameInput = el('input', { placeholder: 'e.g. Push day', style: 'margin-top:0' });
  const notesInput = el('textarea', { placeholder: 'Notes (optional)' });
  const err = el('p', { class: 'form-error', hidden: true });
  const saveBtn = el('button', { class: 'btn btn-primary btn-block' }, 'Save workout');

  saveBtn.addEventListener('click', async () => {
    const exercises = state
      .map(e => ({
        name: e.nameInput.value.trim(),
        sets: e.sets
          .map(s => ({ weight: Number(s.weightInput.value) || 0, reps: Number(s.repsInput.value) || 0 }))
          .filter(s => s.reps > 0 || s.weight > 0)
      }))
      .filter(e => e.name || e.sets.length);

    err.hidden = true; saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
    try {
      const { error } = await sb.from('workouts').insert({
        user_id: getUid(),
        workout_date: dateInput.value || todayISO(),
        name: nameInput.value.trim(),
        notes: notesInput.value.trim(),
        exercises
      });
      if (error) throw error;
      closeModal();
      toast('Workout saved 💪', 'ok');
      renderFitness(root);
    } catch (ex) {
      err.textContent = ex.message || 'Failed to save.';
      err.hidden = false; saveBtn.disabled = false; saveBtn.textContent = 'Save workout';
    }
  });

  openModal(el('div', {}, [
    el('h3', {}, 'Log workout'),
    el('label', {}, ['Date', dateInput]),
    el('label', {}, ['Workout name', nameInput]),
    el('div', { class: 'section-head', style: 'margin:6px 2px 10px' }, [el('h2', {}, 'Exercises')]),
    exWrap,
    el('button', { type: 'button', class: 'btn btn-ghost btn-block', style: 'margin-bottom:14px', onClick: addExercise }, '＋ Add exercise'),
    el('label', {}, ['Notes', notesInput]),
    err,
    saveBtn
  ]));
}
