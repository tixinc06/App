// Bodyweight-relative strength standards: maps an estimated-1RM-to-bodyweight
// ratio to a RANK DIVISION for a given exercise. Curated per-lift thresholds
// for common exercises, with a generic fallback so ANY logged exercise still
// ranks.
//
// Divisional model (Rocket-League-style): 7 GROUPS — Bronze, Silver, Gold,
// Platinum, Diamond ×5 divisions each, Champion, Grand Champion ×3 divisions
// each — 31 divisions total (global index 0-30). Godly sits above all of
// this and is NOT reachable by ratio alone (see js/ranks.js) — it needs a
// maxed-out Grand Champion 3 (globalIndex 30) AND a top-500 global position.
//
// The underlying anchor data is UNCHANGED from the old 8-tier model — the
// 8th anchor (formerly "Godly threshold") is simply reinterpreted as the
// ratio that COMPLETES Grand Champion (maxes out division 3), which is
// exactly the ceiling needed to interpolate GC's own 3 divisions. No
// re-tuning of the curated numbers was needed.
//
// NOTE: pure bodyweight moves logged with weight=0 (e.g. plain pull-ups) will
// always compute e1RM=0 via the Epley formula and won't rank — a known
// limitation, not something this phase attempts to solve.

export const GROUPS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'Grand Champion'];
export const DIVISIONS_PER_GROUP = [5, 5, 5, 5, 5, 3, 3];
export const TOTAL_DIVISIONS = DIVISIONS_PER_GROUP.reduce((a, b) => a + b, 0); // 31 (indices 0-30)

// Ratio (best e1RM / bodyweight) required to REACH each of the 7 groups,
// plus an 8th value = the ratio that COMPLETES Grand Champion (maxedOut).
const STANDARDS = {
  'Bench Press':            [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5],
  'Squat':                  [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0],
  'Deadlift':               [1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0, 3.5],
  'Overhead Press':         [0.35, 0.5, 0.65, 0.8, 1.0, 1.2, 1.4, 1.6],
  'Barbell Row':            [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25],
  'Romanian Deadlift':      [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.25, 2.5],
  'Incline Dumbbell Press': [0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2, 1.4],
  'Lat Pulldown':           [0.5, 0.7, 0.9, 1.1, 1.3, 1.5, 1.7, 2.0],
  'Leg Press':              [1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0],
  'Leg Curl':               [0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.9, 1.1],
  'Calf Raise':             [0.75, 1.0, 1.25, 1.5, 1.75, 2.0, 2.5, 3.0],
  'Bicep Curl':             [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1.0],
  'Triceps Pushdown':       [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.85, 1.0],
  'Lateral Raise':          [0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.42, 0.5],
  'Face Pull':              [0.15, 0.22, 0.3, 0.38, 0.46, 0.55, 0.65, 0.8]
};

// Generic fallback curve for any exercise not in the curated table above.
const FALLBACK_STANDARD = [0.4, 0.6, 0.8, 1.0, 1.25, 1.5, 1.8, 2.2];

// Returns division info for a given ratio (e1RM / bodyweight) on a named
// exercise: { group, division, globalIndex, label, ratio, progressToNext,
// maxedOut, nextLabel, nextRatio }. `group`/`globalIndex` are null/-1 below
// Bronze 1. `division` is 1-based (Bronze 1..5, etc). `globalIndex` is
// 0-based across the whole 31-division ladder, capped at 30 once maxedOut.
export function divisionForRatio(ratio, exerciseName) {
  const thresholds = STANDARDS[exerciseName] || FALLBACK_STANDARD;

  let groupIdx = -1;
  for (let i = 0; i < GROUPS.length; i++) {
    if (ratio >= thresholds[i]) groupIdx = i; else break;
  }

  if (groupIdx < 0) {
    return {
      group: null, division: 0, globalIndex: -1, label: null, ratio,
      progressToNext: thresholds[0] > 0 ? Math.max(0, Math.min(1, ratio / thresholds[0])) : 0,
      maxedOut: false, nextLabel: 'Bronze 1', nextRatio: thresholds[0]
    };
  }

  const groupStart = thresholds[groupIdx];
  const groupEnd = thresholds[groupIdx + 1];
  const divisionsInGroup = DIVISIONS_PER_GROUP[groupIdx];
  const span = groupEnd - groupStart;
  const posInGroup = span > 0 ? (ratio - groupStart) / span : 1;
  const divisionIdx = Math.min(divisionsInGroup - 1, Math.max(0, Math.floor(posInGroup * divisionsInGroup)));
  const maxedOut = groupIdx === GROUPS.length - 1 && ratio >= groupEnd;

  let globalIndex = 0;
  for (let i = 0; i < groupIdx; i++) globalIndex += DIVISIONS_PER_GROUP[i];
  globalIndex += divisionIdx;
  if (maxedOut) globalIndex = TOTAL_DIVISIONS - 1;

  const division = divisionIdx + 1;
  const label = `${GROUPS[groupIdx]} ${division}`;

  const divisionSpan = span / divisionsInGroup;
  const divisionStart = groupStart + divisionIdx * divisionSpan;
  const divisionEnd = divisionStart + divisionSpan;
  const progressToNext = maxedOut ? 1 : Math.max(0, Math.min(1, divisionSpan > 0 ? (ratio - divisionStart) / divisionSpan : 1));

  let nextLabel = null, nextRatio = null;
  if (!maxedOut) {
    if (divisionIdx + 1 < divisionsInGroup) {
      nextLabel = `${GROUPS[groupIdx]} ${division + 1}`;
      nextRatio = divisionEnd;
    } else {
      nextLabel = `${GROUPS[groupIdx + 1]} 1`;
      nextRatio = groupEnd;
    }
  }

  return { group: GROUPS[groupIdx], division, globalIndex, label, ratio, progressToNext, maxedOut, nextLabel, nextRatio };
}

// Reverse of the globalIndex part of divisionForRatio — turns a 0-based
// global division index (0-30) back into { group, division, globalIndex }.
// Used for the AGGREGATE overall rank, which averages global indices across
// exercises rather than working from a single ratio.
export function globalIndexToLabel(globalIndex) {
  if (globalIndex == null || globalIndex < 0) return null;
  let idx = Math.max(0, Math.min(TOTAL_DIVISIONS - 1, Math.round(globalIndex)));
  let remaining = idx;
  for (let i = 0; i < GROUPS.length; i++) {
    if (remaining < DIVISIONS_PER_GROUP[i]) {
      return { group: GROUPS[i], division: remaining + 1, globalIndex: idx };
    }
    remaining -= DIVISIONS_PER_GROUP[i];
  }
  const lastGroup = GROUPS[GROUPS.length - 1];
  return { group: lastGroup, division: DIVISIONS_PER_GROUP[GROUPS.length - 1], globalIndex: idx };
}
