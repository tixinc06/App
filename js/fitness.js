// Fitness view: a gamified hub with sub-tabs. Profile is the landing tab (an
// eg4-style hub: status header, avatar hero, friends CTA, shortcuts,
// Memories calendar, then quests/goals/PRs/achievements — see js/progress.js,
// which keeps its old filename/export name to minimise churn). Train hosts
// the workout planner (templates/splits, from workouts.js) plus workout
// logging + bodyweight tracking (below). Friends also has a Home-level entry
// (js/app.js) — both call the exact same js/social.js renderFriends.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import {
  el, num, fmtDate, todayISO, isoOf, toast, formModal, confirmModal, actionSheet,
  emptyState, openModal, closeModal, skeleton, staggerChildren, countUp, segmented, celebrate
} from './ui.js';
import { lineChart, barChart, chartCard } from './charts.js';
import { renderTrain } from './workouts.js';
import { renderProgress } from './progress.js';
import { renderRanks } from './ranks.js';
import { renderShop } from './shop.js';
import { renderFriends } from './social.js';
import { detectAndSavePRs, checkGoals, award, loadProgress, isOnCooldown } from './progression.js';
import { computeStreak } from './streaks.js';
import { loadStats, checkAchievements } from './achievements.js';
import { attachExercisePicker, loadPreviousPerformance } from './exercises.js';
import { startRestTimer, durationPickerEl, loadLastDuration } from './resttimer.js';

let fitSegment = 'profile'; // 'profile' | 'train' | 'ranks' | 'shop' | 'friends'

// Lets other Fitness-scoped modules (js/progress.js's shortcut grid) jump to
// a different sub-tab without needing to import/mutate module-private state
// directly — e.g. goToSegment('ranks', root) from the Profile hub's grid.
export function goToSegment(seg, root) {
  fitSegment = seg;
  renderFitness(root);
}

export async function renderFitness(root) {
  root.innerHTML = '';
  root.append(segmented([
    { value: 'profile', label: 'Profile' },
    { value: 'train', label: 'Train' },
    { value: 'ranks', label: 'Ranks' },
    { value: 'shop', label: 'Shop' },
    { value: 'friends', label: 'Friends' }
  ], fitSegment, v => { fitSegment = v; renderFitness(root); }));

  const body = el('div');
  root.append(body);

  if (fitSegment === 'profile') {
    await renderProgress(body, root);
    return;
  }

  if (fitSegment === 'ranks') {
    await renderRanks(body, root);
    return;
  }

  if (fitSegment === 'shop') {
    await renderShop(body, root);
    return;
  }

  if (fitSegment === 'friends') {
    await renderFriends(body, root);
    return;
  }

  const plannerSection = el('div');
  const logSection = el('div');
  body.append(plannerSection, logSection);
  await renderTrain(plannerSection, root);
  await renderTrainingLog(logSection, root);
}

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

// Existing workout log + bodyweight tracking, now rendered INTO `container`
// (a sub-section of the Train tab) rather than the true page `root`. Nested
// actions still take `root` so a save can trigger a full Fitness-tab refresh.
async function renderTrainingLog(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(4, 'item'));
  let data;
  try {
    data = await loadData();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load data. ' + (ex.message || '')));
    return;
  }
  const { workouts, weights } = data;
  container.innerHTML = '';

  // ── Bodyweight card ──
  const latest = weights[0];
  const prev = weights[1];
  const delta = latest && prev ? Number(latest.weight) - Number(prev.weight) : null;
  const weightNumEl = el('span', {}, latest ? '' : '—');
  container.append(el('div', { class: 'card', style: 'padding:18px;margin-bottom:20px' }, [
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
    container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Weight history')]));
    const weightList = el('div', { class: 'list', style: 'margin-bottom:22px' },
      weights.slice(0, 8).map(w =>
        el('div', { class: 'card item', onClick: () => weightActions(w, root) }, [
          el('div', { class: 'grow' }, [el('div', { class: 'title' }, num(w.weight))]),
          el('div', { class: 'sub' }, fmtDate(w.entry_date))
        ])));
    staggerChildren(weightList);
    container.append(weightList);
  }

  // ── Bodyweight trend ──
  if (weights.length >= 2) {
    const series = [...weights].reverse().map(w => ({ t: w.entry_date, v: +w.weight }));
    container.append(chartCard('Bodyweight trend', lineChart(series, { color: 'var(--blue)', fmt: v => num(v) })));
  }

  // ── Workouts ──
  container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Workouts')]));
  if (!workouts.length) {
    container.append(emptyState('💪', 'No workouts yet. Tap + to log one.'));
  } else {
    const workoutList = el('div', { class: 'list' }, workouts.map(w => workoutRow(w, root)));
    staggerChildren(workoutList);
    container.append(workoutList);

    const bars = weeklyCounts(workouts, 8);
    if (bars.some(b => b.value > 0)) {
      container.append(el('div', { class: 'section-head', style: 'margin-top:20px' }, [el('h2', {}, 'Insights')]));
      container.append(chartCard('Workouts · per week', barChart(bars, { color: 'var(--upper, var(--primary-soft))', fmt: v => String(v) })));
    }
  }

  container.append(el('button', { class: 'fab', title: 'Log workout', onClick: () => workoutBuilder(root) }, '+'));
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
// `prefill`, if given, is { name, exercises: [{name, sets}] } from a template —
// pre-populates the workout name and one exercise row (with that many empty
// set rows) per template exercise, ready for the user to fill in real weights.
export function workoutBuilder(root, prefill) {
  const exWrap = el('div');
  const state = []; // [{ nameInput, sets: [{weightInput, repsInput, ticked}] , node }]
  let restSeconds = loadLastDuration();
  const startedAt = Date.now();

  function addExercise(initialName = '', initialSets = 1) {
    const setsWrap = el('div', { style: 'margin:8px 0 0' });
    const sets = [];
    const nameInput = el('input', { placeholder: 'Exercise name', value: initialName, style: 'margin-top:0' });
    const nameWrap = el('div', { style: 'flex:1;min-width:0' }, [nameInput]);
    attachExercisePicker(nameInput);

    const hintEl = el('div', { class: 'dim', style: 'font-size:12px;margin-top:6px', hidden: true });
    let hintTimer = null;
    function refreshHint() {
      clearTimeout(hintTimer);
      const name = nameInput.value.trim();
      if (!name) { hintEl.hidden = true; return; }
      hintTimer = setTimeout(async () => {
        const prev = await loadPreviousPerformance(name);
        if (!prev) { hintEl.hidden = true; return; }
        hintEl.textContent = `Last time (${fmtDate(prev.date)}): ` +
          prev.sets.map(s => `${num(s.weight)}×${num(s.reps)}`).join(', ');
        hintEl.hidden = false;
      }, 450);
    }
    nameInput.addEventListener('input', refreshHint);
    if (initialName) refreshHint();

    function addSet(weight = '', reps = '') {
      const wI = el('input', { type: 'number', inputmode: 'decimal', step: '0.5', placeholder: 'kg', value: weight, style: 'margin-top:0' });
      const rI = el('input', { type: 'number', inputmode: 'numeric', step: '1', placeholder: 'reps', value: reps, style: 'margin-top:0' });
      const rowObj = { weightInput: wI, repsInput: rI, ticked: false };
      const tickBtn = el('button', {
        type: 'button', class: 'set-tick', title: 'Mark set done (starts rest timer)',
        onClick: () => {
          rowObj.ticked = !rowObj.ticked;
          tickBtn.classList.toggle('ticked', rowObj.ticked);
          if (rowObj.ticked) startRestTimer(restSeconds);
        }
      }, '✓');
      const row = el('div', { class: 'row', style: 'margin-bottom:8px;align-items:center' }, [
        tickBtn, wI, rI,
        el('button', {
          type: 'button', class: 'btn btn-sm btn-ghost', style: 'flex:0 0 auto',
          onClick: () => { const i = sets.indexOf(rowObj); if (i > -1) sets.splice(i, 1); row.remove(); }
        }, '✕')
      ]);
      sets.push(rowObj);
      setsWrap.append(row);
    }
    for (let i = 0; i < Math.max(1, initialSets); i++) addSet();

    const exObj = { nameInput, sets };
    const node = el('div', { class: 'card', style: 'padding:14px;margin-bottom:12px' }, [
      el('div', { class: 'row', style: 'align-items:center' }, [
        nameWrap,
        el('button', {
          type: 'button', class: 'btn btn-sm btn-danger', style: 'flex:0 0 auto',
          onClick: () => { const i = state.indexOf(exObj); if (i > -1) state.splice(i, 1); node.remove(); }
        }, '🗑')
      ]),
      hintEl,
      setsWrap,
      el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: () => addSet() }, '＋ Add set')
    ]);
    state.push(exObj);
    exWrap.append(node);
  }

  if (prefill?.exercises?.length) {
    for (const ex of prefill.exercises) addExercise(ex.name, ex.sets);
  } else {
    addExercise();
  }

  const dateInput = el('input', { type: 'date', value: todayISO(), style: 'margin-top:0' });
  const nameInput = el('input', { placeholder: 'e.g. Push day', value: prefill?.name || '', style: 'margin-top:0' });
  const notesInput = el('textarea', { placeholder: 'Notes (optional)' });
  const err = el('p', { class: 'form-error', hidden: true });
  const saveBtn = el('button', { class: 'btn btn-primary btn-block' }, 'Save workout');

  const durationEl = el('span', { class: 'dim', style: 'font-size:12px' }, '0:00 elapsed');
  const durationTimer = setInterval(() => {
    if (!document.body.contains(durationEl)) { clearInterval(durationTimer); return; }
    const s = Math.floor((Date.now() - startedAt) / 1000);
    durationEl.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} elapsed`;
  }, 1000);

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

      // The whole progression pipeline (PR/goal detection, achievement
      // unlocks, XP/Plate award) is skipped entirely while on cooldown —
      // not just the award() call. Detecting a PR or completing a goal
      // would otherwise mark it permanently (personal_records upsert,
      // fitness_goals.achieved, achievements table) with no XP ever paid
      // out for it, since award() refuses to grant XP during cooldown.
      // Skipping everything defers detection cleanly to the next
      // non-cooldown save — zero data loss, no burned rewards.
      let gains = null, cooldownUntil = null;
      try {
        cooldownUntil = await isOnCooldown();
        if (!cooldownUntil) {
          const totalSets = exercises.reduce((a, e) => a + (e.sets?.length || 0), 0);
          const prEvents = await detectAndSavePRs(exercises);
          const goalEvents = await checkGoals();
          gains = await award([{ type: 'workout', sets: totalSets }, ...prEvents, ...goalEvents]);
        }
      } catch { /* progression failure shouldn't hide that the workout saved */ }

      if (cooldownUntil) {
        const mins = Math.max(1, Math.round((cooldownUntil - new Date()) / 60000));
        toast(`Workout saved 💪 · On cooldown — ${Math.floor(mins / 60)}h ${mins % 60}m left`, 'ok');
      } else if (gains) {
        const bits = [`+${gains.xpGain} XP`, `+${gains.platesGain} Plates`];
        if (gains.boosterApplied) bits.push(`⚡${gains.boosterApplied}× boost`);
        if (gains.levelsGained > 0) bits.push(gains.levelsGained > 1 ? `Level up ×${gains.levelsGained}!` : 'Level up!');
        toast(bits.join(' · '), 'ok');
        if (gains.levelsGained > 0) celebrate();
      } else {
        toast('Workout saved 💪', 'ok');
      }

      // Achievement check is separate + best-effort, and also fully skipped
      // during cooldown (see above) — it must never block the workout save.
      if (!cooldownUntil) {
        try {
          const prog = gains?.progress || await loadProgress();
          const { data: wRows } = await sb.from('workouts').select('workout_date').eq('user_id', getUid());
          const streak = await computeStreak(wRows || []);
          const stats = await loadStats(prog, streak.current);
          const achEvents = await checkAchievements(stats);
          if (achEvents.length) {
            const achGains = await award(achEvents);
            for (const a of achEvents) toast(`🏆 ${a.label} unlocked! +${a.xp} XP · +${a.plates} Plates`, 'ok');
            celebrate();
            if (achGains?.levelsGained > 0) toast(achGains.levelsGained > 1 ? `Level up ×${achGains.levelsGained}!` : 'Level up!', 'ok');
          }
        } catch { /* best-effort — achievements can catch up on the next save */ }
      }

      renderFitness(root);
    } catch (ex) {
      err.textContent = ex.message || 'Failed to save.';
      err.hidden = false; saveBtn.disabled = false; saveBtn.textContent = 'Save workout';
    }
  });

  openModal(el('div', {}, [
    el('div', { style: 'display:flex;align-items:center;justify-content:space-between;margin-bottom:2px' }, [
      el('h3', {}, prefill?.name ? 'Start: ' + prefill.name : 'Log workout'),
      durationEl
    ]),
    el('label', {}, ['Date', dateInput]),
    el('label', {}, ['Workout name', nameInput]),
    el('div', { class: 'section-head', style: 'margin:10px 2px 2px' }, [el('h2', {}, 'Rest timer')]),
    durationPickerEl(restSeconds, v => { restSeconds = v; }),
    el('div', { class: 'section-head', style: 'margin:10px 2px 10px' }, [el('h2', {}, 'Exercises')]),
    exWrap,
    el('button', { type: 'button', class: 'btn btn-ghost btn-block', style: 'margin-bottom:14px', onClick: () => addExercise() }, '＋ Add exercise'),
    el('label', {}, ['Notes', notesInput]),
    err,
    saveBtn
  ]));
}
