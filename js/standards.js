// Bodyweight-relative strength standards: maps an estimated-1RM-to-bodyweight
// ratio to a rank tier for a given exercise. Curated per-lift thresholds for
// common exercises, with a generic fallback so ANY logged exercise still ranks.
//
// NOTE: pure bodyweight moves logged with weight=0 (e.g. plain pull-ups) will
// always compute e1RM=0 via the Epley formula and won't rank — a known
// limitation, not something this phase attempts to solve.

export const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Champion', 'Grand Champion', 'Godly'];

// Ratio (best e1RM / bodyweight) required to REACH each tier, in TIERS order.
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

// Returns { tier, tierIndex, currentThreshold, nextTier, nextThreshold } for
// a given ratio (e1RM / bodyweight) on a named exercise. tier/tierIndex are
// null/-1 if the ratio doesn't reach even the first (Bronze) threshold.
export function tierForRatio(ratio, exerciseName) {
  const thresholds = STANDARDS[exerciseName] || FALLBACK_STANDARD;
  let idx = -1;
  for (let i = 0; i < thresholds.length; i++) {
    if (ratio >= thresholds[i]) idx = i; else break;
  }
  return {
    tier: idx >= 0 ? TIERS[idx] : null,
    tierIndex: idx,
    currentThreshold: idx >= 0 ? thresholds[idx] : 0,
    nextTier: idx + 1 < TIERS.length ? TIERS[idx + 1] : null,
    nextThreshold: idx + 1 < thresholds.length ? thresholds[idx + 1] : null
  };
}
