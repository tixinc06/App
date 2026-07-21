// Ranks tab: a per-exercise strength tier (from bodyweight-relative e1RM) plus
// an aggregate overall rank badge. No dedicated table — computed live from
// personal_records + the latest weight_entries.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { el, num, emptyState, skeleton, staggerChildren } from './ui.js';
import { tierForRatio, TIERS } from './standards.js';

const TIER_CLASS = {
  'Bronze': 'rank-bronze', 'Silver': 'rank-silver', 'Gold': 'rank-gold', 'Platinum': 'rank-platinum',
  'Diamond': 'rank-diamond', 'Champion': 'rank-champion', 'Grand Champion': 'rank-grand-champion', 'Godly': 'rank-godly'
};

// A couple of major compounds count double toward the overall aggregate so a
// handful of isolation lifts can't skew it.
const MAJOR_LIFTS = new Set(['Bench Press', 'Squat', 'Deadlift', 'Overhead Press']);

// Exported so the Profile hub (js/progress.js) can show a rank emblem
// without duplicating the bodyweight/PR fetch + tier math.
export async function loadOverallRank() {
  const { prs, bodyweight } = await loadRankData();
  if (!bodyweight) return null;
  return computeOverallRank(computeExerciseRanks(prs, bodyweight));
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
      return { exercise: pr.exercise, e1rm: Number(pr.best_e1rm), ratio, ...tierForRatio(ratio, pr.exercise) };
    })
    .sort((a, b) => b.ratio - a.ratio);
}

function computeOverallRank(exerciseRanks) {
  const ranked = exerciseRanks.filter(r => r.tierIndex >= 0);
  if (!ranked.length) return null;
  let weightedSum = 0, weightTotal = 0;
  for (const r of ranked) {
    const w = MAJOR_LIFTS.has(r.exercise) ? 2 : 1;
    weightedSum += r.tierIndex * w;
    weightTotal += w;
  }
  const idx = Math.min(TIERS.length - 1, Math.round(weightedSum / weightTotal));
  return { tier: TIERS[idx], tierIndex: idx };
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
  const overall = computeOverallRank(exerciseRanks);

  container.append(overallCard(overall, data.bodyweight));

  container.append(el('div', { class: 'section-head' }, [el('h2', {}, 'Per-exercise')]));
  if (!exerciseRanks.length) {
    container.append(emptyState('🏋️', 'Log workouts to start ranking your lifts.'));
  } else {
    const list = el('div', { class: 'list' }, exerciseRanks.map(exerciseRankRow));
    staggerChildren(list);
    container.append(list);
  }
}

export function rankBadge(tier) {
  if (!tier) return el('span', { class: 'pill' }, 'Unranked');
  return el('span', { class: 'rank-badge ' + (TIER_CLASS[tier] || '') }, tier);
}

function overallCard(overall, bodyweight) {
  return el('div', { class: 'card', style: 'padding:18px;margin-bottom:20px;text-align:center' }, [
    el('div', { class: 'k', style: 'font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase' }, 'Overall rank'),
    el('div', { style: 'margin-top:10px' }, [rankBadge(overall?.tier)]),
    el('div', { class: 'dim', style: 'font-size:12px;margin-top:10px' }, `Based on bodyweight: ${num(bodyweight)}kg`)
  ]);
}

function exerciseRankRow(r) {
  let progressText;
  if (r.nextTier && r.nextThreshold != null) {
    const span = r.nextThreshold - r.currentThreshold;
    const pct = span > 0 ? Math.max(0, Math.min(100, ((r.ratio - r.currentThreshold) / span) * 100)) : 100;
    progressText = `${pct.toFixed(0)}% to ${r.nextTier}`;
  } else {
    progressText = 'Max tier!';
  }
  return el('div', { class: 'card item' }, [
    el('div', { class: 'thumb' }, '🏋️'),
    el('div', { class: 'grow' }, [
      el('div', { class: 'title' }, r.exercise),
      el('div', { class: 'sub' }, `${num(r.e1rm)}kg e1RM · ${r.ratio.toFixed(2)}× bodyweight · ${progressText}`)
    ]),
    rankBadge(r.tier)
  ]);
}
