// Exercise detail page: a drill-in shown for one exercise, reached from the
// Ranks tab's per-exercise rows and the Profile hub's PR rows (js/ranks.js,
// js/progress.js). Deliberately NOT reachable from inside the workout-builder
// modal — the app has a single #modal-host, so a second openModal() would
// destroy the builder (the same constraint that shaped Round 5's reorder mode).
//
// `onBack()` is a caller-supplied callback that re-renders whichever screen
// opened this page (Ranks or PRs) — kept caller-driven rather than a shared
// profileView enum so this module has no dependency on js/progress.js's state
// machine and js/ranks.js can reach it without a circular import.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, num, fmtDate, emptyState, skeleton } from './ui.js';
import { divisionForRatio } from './standards.js';
import { pipRow, groupColor } from './rankart.js';
import { exerciseThumb } from './exercisemedia.js';
import { fmtWeight, kgToDisplay } from './units.js';
import { estimatedE1RM } from './progression.js';
import { lineChart, chartCard } from './charts.js';

async function loadDetail(exerciseName) {
  const uid = getUid();
  const [prRes, weightRes, workoutsRes] = await Promise.all([
    sb.from('personal_records').select('*').eq('user_id', uid).eq('exercise', exerciseName).maybeSingle(),
    sb.from('weight_entries').select('weight').order('entry_date', { ascending: false }).limit(1),
    sb.from('workouts').select('workout_date,exercises').eq('user_id', uid).order('workout_date', { ascending: true })
  ]);
  if (prRes.error) throw prRes.error;
  if (weightRes.error) throw weightRes.error;
  if (workoutsRes.error) throw workoutsRes.error;

  const bodyweight = weightRes.data?.[0]?.weight ? Number(weightRes.data[0].weight) : null;

  // Every session that logged this exercise, reduced to its best set (by
  // e1RM) for that day — same convention used for PR detection.
  const sessions = [];
  for (const w of (workoutsRes.data || [])) {
    const ex = (w.exercises || []).find(e => (e.name || '').trim().toLowerCase() === exerciseName.trim().toLowerCase());
    if (!ex || !ex.sets?.length) continue;
    let bestSet = null, bestE1rm = 0;
    for (const s of ex.sets) {
      const e1rm = estimatedE1RM(Number(s.weight) || 0, Number(s.reps) || 0);
      if (e1rm > bestE1rm) { bestE1rm = e1rm; bestSet = s; }
    }
    if (bestSet && bestE1rm > 0) sessions.push({ date: w.workout_date, weight: bestSet.weight, reps: bestSet.reps, e1rm: bestE1rm });
  }

  return { pr: prRes.data || null, bodyweight, sessions };
}

export async function renderExerciseDetail(container, root, exerciseName, onBack) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(3, 'item'));
  let detail;
  try {
    detail = await loadDetail(exerciseName);
  } catch (ex) {
    container.innerHTML = '';
    container.append(backHeader(exerciseName, onBack));
    container.append(emptyState('⚠️', 'Could not load exercise. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  container.append(backHeader(exerciseName, onBack));

  container.append(el('div', { class: 'card', style: 'padding:18px;margin-bottom:18px;text-align:center' }, [
    exerciseThumb(exerciseName, null, { size: 84 }),
    el('div', { style: 'font-weight:800;font-size:17px;margin-top:10px' }, exerciseName)
  ]));

  const { pr, bodyweight, sessions } = detail;

  if (!bodyweight) {
    container.append(emptyState('⚖️', 'Log your bodyweight to see this exercise\'s rank.'));
  } else if (!pr) {
    container.append(emptyState('🏋️', 'No sets logged for this exercise yet.'));
  } else {
    const ratio = Number(pr.best_e1rm) / bodyweight;
    const rank = divisionForRatio(ratio, exerciseName);
    container.append(rankCard(rank, pr, bodyweight));
  }

  if (pr) {
    container.append(el('div', { class: 'stat-grid', style: 'margin-bottom:18px' }, [
      statCell('Best set', `${fmtWeight(pr.best_weight)} × ${pr.best_reps}`),
      statCell('Sessions logged', String(sessions.length))
    ]));
  }

  if (sessions.length >= 2) {
    const series = sessions.map(s => ({ t: s.date, v: kgToDisplay(s.e1rm) }));
    container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Estimated 1RM over time')]));
    container.append(chartCard('e1RM', lineChart(series, { color: 'var(--primary-soft)', fmt: v => num(v) })));
  }

  if (sessions.length) {
    container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Session history')]));
    const list = el('div', { class: 'list' }, [...sessions].reverse().map(s =>
      el('div', { class: 'card item' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'title' }, fmtDate(s.date)),
          el('div', { class: 'sub' }, `${fmtWeight(s.weight)} × ${s.reps}`)
        ]),
        el('div', { class: 'amt' }, `${fmtWeight(s.e1rm)} e1RM`)
      ])));
    container.append(list);
  }
}

function backHeader(title, onBack) {
  return el('div', { class: 'section-head profile-subview-head' }, [
    el('button', { type: 'button', class: 'btn btn-sm btn-ghost', onClick: onBack }, '‹ Back'),
    el('h2', {}, title)
  ]);
}

function statCell(label, value) {
  return el('div', { class: 'card stat' }, [el('div', { class: 'k' }, label), el('div', { class: 'v' }, value)]);
}

function rankCard(rank, pr, bodyweight) {
  const color = groupColor(rank.group);
  const kids = [
    el('div', { style: 'display:flex;align-items:center;gap:14px' }, [
      el('div', { style: `font-size:15px;font-weight:800;color:${color}` }, rank.label || 'Unranked'),
      rank.group ? pipRow(rank.division, DIVS[rank.group] || 5, color) : null
    ]),
    el('div', { class: 'dim', style: 'font-size:12px;margin:10px 0 8px' },
      `${fmtWeight(pr.best_e1rm)} e1RM · ${rank.ratio.toFixed(2)}× bodyweight (${fmtWeight(bodyweight)})`)
  ];

  if (!rank.maxedOut && rank.nextRatio) {
    const requiredE1rm = rank.nextRatio * bodyweight;
    const gapE1rm = Math.max(0, requiredE1rm - Number(pr.best_e1rm));
    // The equivalent WORKING weight at the lifter's usual rep count (Epley
    // inverse) — a concrete "lift this much" number is more actionable than
    // a raw e1RM delta the user would have to mentally convert themselves.
    const reps = Math.max(1, Number(pr.best_reps) || 1);
    const requiredWorkingWeight = requiredE1rm / (1 + reps / 30);
    const gapWorkingWeight = Math.max(0, requiredWorkingWeight - Number(pr.best_weight));

    kids.push(
      el('div', { class: 'meter', style: 'margin:8px 0' }, [
        el('div', { class: 'meter-fill', style: `width:${(rank.progressToNext * 100).toFixed(1)}%` })
      ]),
      el('div', { style: 'font-size:13px;font-weight:700' },
        `+${fmtWeight(gapE1rm)} e1RM to ${rank.nextLabel}`),
      el('div', { class: 'dim', style: 'font-size:12px;margin-top:2px' },
        gapWorkingWeight > 0 ? `≈ ${fmtWeight(gapWorkingWeight)} more at ${reps} reps` : 'Almost there')
    );
  } else if (rank.maxedOut) {
    kids.push(el('div', { style: 'font-size:13px;font-weight:700;margin-top:4px' }, 'Max division for this lift! 🏆'));
  }

  return el('div', { class: 'card', style: 'padding:16px 18px;margin-bottom:18px' }, kids);
}

const DIVS = { Bronze: 5, Silver: 5, Gold: 5, Platinum: 5, Diamond: 5, Champion: 3, 'Grand Champion': 3 };
