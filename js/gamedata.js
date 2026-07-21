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

// ── Streaks ──────────────────────────────────────────────────────────────────
// A streak freeze protects one missed training WEEK from breaking your streak
// (js/streaks.js). Bought individually — you can stack several.
export const STREAK_FREEZE_COST = 150;

// Prestige title shown next to your level, indexed by `progress.prestige`
// (0 = not yet prestiged once). Master Prestige gets its own fixed title.
export const PRESTIGE_TITLES = [
  'Rookie', 'Contender', 'Grinder', 'Warrior', 'Veteran',
  'Elite', 'Vanguard', 'Titan', 'Legend', 'Mythic'
];
export const MASTER_TITLE = 'Master';

// ── Quests ───────────────────────────────────────────────────────────────────
// Weekly quests, reset every Monday (week key = ISO year-week). Progress is
// computed live from workouts/PRs/goals in the current week (js/quests.js);
// claiming awards XP/Plates once per quest per week (quest_claims table).
export const QUESTS = [
  { code: 'weekly_3_workouts', label: 'Train 3 times this week', metric: 'workouts', target: 3, xp: 150, plates: 40, icon: '🏋️' },
  { code: 'weekly_5_workouts', label: 'Train 5 times this week', metric: 'workouts', target: 5, xp: 300, plates: 90, icon: '🔥' },
  { code: 'weekly_pr', label: 'Hit a new PR this week', metric: 'prs', target: 1, xp: 200, plates: 60, icon: '📈' },
  { code: 'weekly_goal', label: 'Achieve a goal this week', metric: 'goals', target: 1, xp: 250, plates: 70, icon: '🎯' }
];

// ── Avatar ───────────────────────────────────────────────────────────────────
// A layered character config: {bg, skin, hair, hairColor, face, outfit}. All
// parts are free in v1 (js/avatar.js draws them as flat SVG). Colours use hex
// except 'tank_primary', which reads the equipped theme's --primary so the
// avatar recolours along with the rest of the app.
export const AVATAR_PARTS = {
  backgrounds: [
    { code: 'aurora', name: 'Aurora', colors: ['#1a1035', '#3a1f5c'] },
    { code: 'sunset', name: 'Sunset', colors: ['#3d1a2e', '#7a3b2e'] },
    { code: 'ocean', name: 'Ocean', colors: ['#0a1e2e', '#123a52'] },
    { code: 'forest', name: 'Forest', colors: ['#0d1f14', '#1e3a24'] },
    { code: 'crimson', name: 'Crimson', colors: ['#1a0a0a', '#4a1414'] },
    { code: 'midnight', name: 'Midnight', colors: ['#0a0a12', '#1a1a2e'] }
  ],
  skins: [
    { code: 'light', name: 'Light', color: '#f0c8a0' },
    { code: 'medium', name: 'Medium', color: '#d9a066' },
    { code: 'tan', name: 'Tan', color: '#b97a4b' },
    { code: 'brown', name: 'Brown', color: '#8a5a34' },
    { code: 'dark', name: 'Dark', color: '#5c3a20' },
    { code: 'deep', name: 'Deep', color: '#3d2414' }
  ],
  hair: [
    { code: 'bald', name: 'Bald' },
    { code: 'short', name: 'Short' },
    { code: 'buzz', name: 'Buzz' },
    { code: 'messy', name: 'Messy' },
    { code: 'long', name: 'Long' },
    { code: 'quiff', name: 'Quiff' },
    { code: 'ponytail', name: 'Ponytail' },
    { code: 'curly', name: 'Curly' }
  ],
  hairColors: [
    { code: 'black', name: 'Black', color: '#1a1a1a' },
    { code: 'brown', name: 'Brown', color: '#5c3a20' },
    { code: 'blonde', name: 'Blonde', color: '#d9b566' },
    { code: 'red', name: 'Red', color: '#a34a2e' },
    { code: 'gray', name: 'Gray', color: '#8a8a8a' },
    { code: 'blue', name: 'Blue', color: '#3f6fb6' },
    { code: 'pink', name: 'Pink', color: '#e06ba8' },
    { code: 'green', name: 'Green', color: '#3fa864' }
  ],
  faces: [
    { code: 'focused', name: 'Focused' },
    { code: 'smile', name: 'Smile' },
    { code: 'fierce', name: 'Fierce' },
    { code: 'cool', name: 'Cool' },
    { code: 'determined', name: 'Determined' }
  ],
  outfits: [
    { code: 'tank_black', name: 'Black Tank', color: '#22222a' },
    { code: 'tank_primary', name: 'Team Colors', color: 'var(--primary)' },
    { code: 'stringer', name: 'Stringer', color: '#3a2a2a' },
    { code: 'hoodie', name: 'Hoodie', color: '#2a3a4a' },
    { code: 'tracksuit', name: 'Tracksuit', color: '#1a2a1a' },
    { code: 'shirtless', name: 'Shirtless', color: null }
  ]
};

export const DEFAULT_AVATAR = {
  bg: 'aurora', skin: 'medium', hair: 'short', hairColor: 'brown', face: 'focused', outfit: 'tank_black'
};

// ── Achievements ─────────────────────────────────────────────────────────────
// One-time unlocks, persisted to the `achievements` table so history and
// unlock timestamps survive even if the underlying stat later changes.
// `metric` is looked up against a stats object built by js/achievements.js.
export const ACHIEVEMENTS = [
  { code: 'first_workout', label: 'First Workout', icon: '🥇', metric: 'workoutsTotal', target: 1, xp: 50, plates: 20 },
  { code: 'workouts_10', label: '10 Workouts', icon: '🏋️', metric: 'workoutsTotal', target: 10, xp: 100, plates: 30 },
  { code: 'workouts_50', label: '50 Workouts', icon: '💪', metric: 'workoutsTotal', target: 50, xp: 300, plates: 80 },
  { code: 'workouts_100', label: '100 Workouts', icon: '🏆', metric: 'workoutsTotal', target: 100, xp: 600, plates: 150 },
  { code: 'first_pr', label: 'First PR', icon: '📈', metric: 'prsTotal', target: 1, xp: 80, plates: 25 },
  { code: 'prs_10', label: '10 Personal Records', icon: '🚀', metric: 'prsTotal', target: 10, xp: 250, plates: 70 },
  { code: 'first_goal', label: 'First Goal Achieved', icon: '🎯', metric: 'goalsTotal', target: 1, xp: 100, plates: 30 },
  { code: 'first_prestige', label: 'First Prestige', icon: '⭐', metric: 'prestige', target: 1, xp: 200, plates: 60 },
  { code: 'prestige_5', label: 'Prestige 5', icon: '🌟', metric: 'prestige', target: 5, xp: 500, plates: 150 },
  { code: 'master_prestige', label: 'Master Prestige', icon: '👑', metric: 'isMaster', target: 1, xp: 1000, plates: 300 },
  { code: 'streak_4', label: '4-Week Streak', icon: '🔥', metric: 'streak', target: 4, xp: 150, plates: 40 },
  { code: 'streak_12', label: '12-Week Streak', icon: '🔥🔥', metric: 'streak', target: 12, xp: 400, plates: 100 }
];
