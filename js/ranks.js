// Ranks tab: divisional strength ranks (Bronze 1 → Grand Champion 3, then
// Godly) computed from bodyweight-relative e1RM per exercise, plus an
// aggregate overall rank. No dedicated table for the ranks themselves —
// computed live from personal_records + the latest weight_entries.
// fitness_progress.rank_score is persisted so global_rank_position() (used
// to gate Godly) can compare across users without RLS ever exposing another
// user's row directly — see migration-ranks.sql.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, num, emptyState, skeleton, staggerChildren } from './ui.js';
import { divisionForRatio, globalIndexToLabel, GROUPS, DIVISIONS_PER_GROUP, TOTAL_DIVISIONS } from './standards.js';
import { rankTile, pipRow, groupColor } from './rankart.js';
import { fmtWeight } from './units.js';

// A couple of major compounds count double toward the overall aggregate so a
// handful of isolation lifts can't skew it.
const MAJOR_LIFTS = new Set(['Bench Press', 'Squat', 'Deadlift', 'Overhead Press']);

// Exported so the Profile hub (js/progress.js) can show a rank emblem
// without duplicating the bodyweight/PR fetch + tier math.
export async function loadOverallRank() {
  const { prs, bodyweight } = await loadRankData();
  if (!bodyweight) return null;
  const exerciseRanks = computeExerciseRanks(prs, bodyweight);
  return finalizeOverallRank(computeOverallRank(exerciseRanks));
}

// Persists rank_score (best-effort) and resolves Godly via the global
// position RPC. Split out from loadOverallRank() so renderRanks() below can
// reuse it on data it's already fetched, instead of fetching + computing
// everything twice on one screen.
async function finalizeOverallRank(overall) {
  if (!overall) return null;

  try {
    await sb.from('fitness_progress').update({ rank_score: overall.rankScore }).eq('user_id', getUid());
  } catch { /* best-effort — Godly gating just won't update this cycle */ }

  let position = null, total = null;
  if (overall.maxedOut) {
    try {
      const { data, error } = await sb.rpc('global_rank_position');
      if (!error && data?.[0]) { position = Number(data[0].rank_position); total = Number(data[0].total_users); }
    } catch { /* best-effort — Godly simply won't show if this fails */ }
  }

  const isGodly = overall.maxedOut && position != null && position <= 500;
  const result = { ...overall, position, total, isGodly };
  // Every caller (progress.js's hero, rankBadge, the ladder) reads
  // group/label directly — override them here once, rather than requiring
  // every call site to remember to special-case isGodly.
  if (isGodly) { result.group = 'Godly'; result.label = 'Godly'; }
  return result;
}

async function loadRankData() {
  const uid = getUid();
  const [prs, weights] = await Promise.all([
    sb.from('personal_records').select('*').eq('user_id', uid),
    sb.from('weight_entries').select('weight').order('entry_date', { ascending: false }).limit(1)
  ]);
  if (prs.error) throw prs.error;
  if (weights.error) throw weights.error;
  const bodyweight = weights.data?.[0]?.weight ? Number(weights.data[0].weight) : null;
  return { prs: prs.data || [], bodyweight };
}

function computeExerciseRanks(prs, bodyweight) {
  return prs
    .map(pr => {
      const ratio = Number(pr.best_e1rm) / bodyweight;
      return { exercise: pr.exercise, e1rm: Number(pr.best_e1rm), ...divisionForRatio(ratio, pr.exercise) };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

// Aggregate = MAJOR_LIFTS-weighted average of per-exercise GLOBAL DIVISION
// INDICES (0-30, continuous) -> rank_score. maxedOut is only true if the
// raw (unrounded) average is exactly 30 — since every input is capped at
// 30, that can only happen if every ranked lift is itself maxed.
function computeOverallRank(exerciseRanks) {
  const ranked = exerciseRanks.filter(r => r.globalIndex >= 0);
  if (!ranked.length) return null;
  let weightedSum = 0, weightTotal = 0;
  for (const r of ranked) {
    const w = MAJOR_LIFTS.has(r.exercise) ? 2 : 1;
    // Continuous position within the exercise's current division (not just the
    // rounded-down globalIndex) so the overall aggregate keeps fractional
    // progress-to-next-division info instead of flattening it to 0.
    const continuous = Math.min(TOTAL_DIVISIONS - 1, r.globalIndex + (r.progressToNext || 0));
    weightedSum += continuous * w;
    weightTotal += w;
  }
  const rankScore = weightedSum / weightTotal;
  const maxedOut = rankScore >= TOTAL_DIVISIONS - 1;
  const displayIdx = Math.min(TOTAL_DIVISIONS - 1, Math.floor(rankScore));
  const { group, division } = globalIndexToLabel(displayIdx);
  const progressToNext = maxedOut ? 1 : (rankScore - displayIdx);
  const nextInfo = (!maxedOut && displayIdx + 1 < TOTAL_DIVISIONS) ? globalIndexToLabel(displayIdx + 1) : null;
  return {
    group, division, globalIndex: displayIdx, rankScore, maxedOut, progressToNext,
    label: `${group} ${division}`,
    nextLabel: nextInfo ? `${nextInfo.group} ${nextInfo.division}` : null
  };
}

export async function renderRanks(container, root) {
  container.innerHTML = '';
  container.append(skeleton(1, 'block'), skeleton(4, 'item'));
  let data;
  try {
    data = await loadRankData();
  } catch (ex) {
    container.innerHTML = '';
    container.append(emptyState('⚠️', 'Could not load ranks. ' + (ex.message || '')));
    return;
  }
  container.innerHTML = '';

  if (!data.bodyweight) {
    container.append(emptyState('⚖️', 'Log your bodyweight on the Train tab to unlock ranks — they\'re calculated relative to your bodyweight.'));
    return;
  }

  const exerciseRanks = computeExerciseRanks(data.prs, data.bodyweight);
  const overall = await finalizeOverallRank(computeOverallRank(exerciseRanks));

  container.append(overallCard(overall, data.bodyweight));

  container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Rank ladder')]));
  container.append(fullLadder(overall));

  container.append(el('div', { class: 'section-head', style: 'margin-top:22px' }, [el('h2', {}, 'Per-exercise')]));
  if (!exerciseRanks.length) {
    container.append(emptyState('🏋️', 'Log workouts to start ranking your lifts.'));
  } else {
    const list = el('div', { class: 'list' }, exerciseRanks.map(exerciseRankRow));
    staggerChildren(list);
    container.append(list);
  }
}

export function rankBadge(rank) {
  if (!rank || !rank.group) return el('span', { class: 'pill' }, 'Unranked');
  const cls = TIER_CLASS[rank.group] || '';
  return el('span', { class: 'rank-badge ' + cls }, rank.label || rank.group);
}

const TIER_CLASS = {
  'Bronze': 'rank-bronze', 'Silver': 'rank-silver', 'Gold': 'rank-gold', 'Platinum': 'rank-platinum',
  'Diamond': 'rank-diamond', 'Champion': 'rank-champion', 'Grand Champion': 'rank-grand-champion', 'Godly': 'rank-godly'
};

function overallCard(overall, bodyweight) {
  if (!overall) {
    return el('div', { class: 'card', style: 'padding:20px;margin-bottom:20px;text-align:center' }, [
      el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Overall rank'),
      el('div', { style: 'display:flex;justify-content:center;margin:12px 0' }, [rankTile(null, { size: 84 })]),
      el('div', { style: 'margin-top:4px' }, [rankBadge(null)]),
      el('div', { class: 'dim', style: 'font-size:12px;margin-top:10px' }, `Based on bodyweight: ${fmtWeight(bodyweight)}`)
    ]);
  }

  const pct = (overall.progressToNext * 100).toFixed(0);

  return el('div', { class: 'card', style: 'padding:20px;margin-bottom:20px;text-align:center' }, [
    el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Overall rank'),
    el('div', { style: 'display:flex;justify-content:center;margin:12px 0' }, [rankTile(overall.group, { size: 96 })]),
    el('div', { style: 'margin-top:2px;font-size:20px;font-weight:800' }, overall.label),
    !overall.isGodly ? el('div', { class: 'meter', style: 'margin-top:14px' }, [
      el('div', { class: 'meter-fill', style: `width:${pct}%` })
    ]) : null,
    !overall.isGodly && overall.nextLabel
      ? el('div', { class: 'dim', style: 'font-size:12px;margin-top:6px' }, `${pct}% to ${overall.nextLabel}`)
      : null,
    overall.maxedOut && !overall.isGodly
      ? el('div', { class: 'dim', style: 'font-size:12px;margin-top:6px' },
          overall.position != null ? `#${overall.position} of ${overall.total} globally · top 500 needed for Godly` : 'Max Grand Champion — checking global position…')
      : null,
    overall.isGodly
      ? el('div', { class: 'dim', style: 'font-size:12px;margin-top:6px' }, `#${overall.position} of ${overall.total} globally`)
      : null,
    el('div', { class: 'dim', style: 'font-size:12px;margin-top:10px' }, `Based on bodyweight: ${fmtWeight(bodyweight)}`)
  ]);
}

// The full ladder as 8 group cards (7 divisional groups + Godly), each
// showing the emblem once with a division-pip row — far lighter than 32
// separate large images, and the same convention Rocket League uses.
function fullLadder(overall) {
  const overallIdx = overall?.globalIndex ?? -1;
  const cards = [];
  let cumulative = 0;

  for (let i = 0; i < GROUPS.length; i++) {
    const group = GROUPS[i];
    const of = DIVISIONS_PER_GROUP[i];
    const groupStart = cumulative;
    cumulative += of;

    let lit;
    if (overallIdx < groupStart) lit = 0;
    else if (overallIdx >= groupStart + of - 1) lit = of;
    else lit = (overallIdx - groupStart) + 1;
    const reached = lit > 0;

    cards.push(el('div', { class: 'rank-ladder-card' + (reached ? '' : ' rank-ladder-locked') }, [
      rankTile(group, { size: 56, locked: !reached }),
      el('div', { class: 'rank-ladder-info' }, [
        el('div', { class: 'rank-ladder-name' }, group),
        pipRow(lit, of, groupColor(group))
      ])
    ]));
  }

  const isGodly = !!overall?.isGodly;
  cards.push(el('div', { class: 'rank-ladder-card' + (isGodly ? '' : ' rank-ladder-locked') }, [
    rankTile('Godly', { size: 56, locked: !isGodly }),
    el('div', { class: 'rank-ladder-info' }, [
      el('div', { class: 'rank-ladder-name' }, 'Godly'),
      el('div', { class: 'dim', style: 'font-size:11px' }, isGodly ? 'Achieved!' : 'Max GC3 + Top 500 globally')
    ])
  ]));

  const grid = el('div', { class: 'rank-ladder-grid' }, cards);
  return grid;
}

function exerciseRankRow(r) {
  const progressText = r.maxedOut ? 'Max division!' : `${(r.progressToNext * 100).toFixed(0)}% to ${r.nextLabel}`;

  return el('div', { class: 'card item' }, [
    el('div', { class: 'thumb' }, '🏋️'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, r.exercise),
      el('div', { class: 'sub' }, `${fmtWeight(r.e1rm)} e1RM · ${r.ratio.toFixed(2)}× bodyweight · ${progressText}`)
    ]),
    rankBadge(r.group ? r : null)
  ]);
}
