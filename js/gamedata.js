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

// ── Shop catalog ──────────────────────────────────────────────────────────────
// Themes recolour the whole app (js/theme.js). Banners are cosmetic gradient
// flair (shown on the Progress tab). Boosters are instant-use: buying one
// immediately activates a temporary XP multiplier (read by progression.award).
export const SHOP_ITEMS = {
  themes: [
    { code: 'default', name: 'Default', price: 0,
      colors: { primary: '#6d5efc', primarySoft: '#9b8dff', bg: '#0b0b12', bg2: '#11111b', accent2: '#3fb6f0' } },
    { code: 'crimson', name: 'Black & Red', price: 300,
      colors: { primary: '#ff3b3b', primarySoft: '#ff6b6b', bg: '#0a0a0a', bg2: '#141414', accent2: '#ff8a3d' } },
    { code: 'emerald', name: 'Emerald', price: 300,
      colors: { primary: '#1fd48c', primarySoft: '#5ce8ac', bg: '#07120d', bg2: '#0d1a14', accent2: '#22c7e0' } },
    { code: 'gold', name: 'Royal Gold', price: 500,
      colors: { primary: '#ffb347', primarySoft: '#ffd08a', bg: '#120d05', bg2: '#1a140a', accent2: '#ff5a36' } },
    { code: 'arctic', name: 'Arctic Blue', price: 300,
      colors: { primary: '#3fb6f0', primarySoft: '#7fd4ff', bg: '#060d12', bg2: '#0c1620', accent2: '#9b8dff' } }
  ],
  banners: [
    { code: 'flame', name: 'Flame', price: 200, gradient: 'linear-gradient(135deg,#ff5a36,#ffb347)' },
    { code: 'ocean', name: 'Ocean', price: 200, gradient: 'linear-gradient(135deg,#1fa2e0,#5fd0ff)' },
    { code: 'violet', name: 'Violet Storm', price: 250, gradient: 'linear-gradient(135deg,#6d5efc,#ff7ae0)' },
    { code: 'gold_foil', name: 'Gold Foil', price: 400, gradient: 'linear-gradient(135deg,#ffd700,#ff8ae2,#5ac8ff)' }
  ],
  boosters: [
    { code: 'xp2x_1h', name: '2× XP Booster', price: 150, multiplier: 2, durationMinutes: 60 },
    { code: 'xp3x_30m', name: '3× XP Booster', price: 200, multiplier: 3, durationMinutes: 30 }
  ]
};
