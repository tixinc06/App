// Economy constants for the Fitness gamification system. Everything tunable
// lives here so the "balanced pace" feel can be adjusted without touching
// game logic elsewhere.

export const XP_PER_WORKOUT_BASE = 60;
export const XP_PER_SET = 4;
export const PLATES_PER_WORKOUT_BASE = 8;
export const PLATES_PER_SET = 1;

export const XP_PER_PR = 100;
export const PLATES_PER_PR = 25;

export const XP_PER_GOAL = 300;
export const PLATES_PER_GOAL = 75;

export const LEVELS_PER_PRESTIGE = 55;
export const MAX_PRESTIGE = 10;       // after the 10th prestige, Master Prestige unlocks
export const MASTER_MAX_LEVEL = 1000;

// XP required to advance FROM `level` TO `level+1` on the normal 1-55 track.
// Gentle linear escalation: fast early levels, gradually slowing.
export function xpForLevel(level) {
  return Math.round(60 + (level - 1) * 5);
}

// Master Prestige (levels 1-1000): a longer, slower curve for the long haul.
export function xpForMasterLevel(level) {
  return Math.round(80 + (level - 1) * 3);
}
