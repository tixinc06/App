// One-time achievement unlocks. The catalog (requirements, XP/Plate rewards)
// lives in gamedata.js; this module computes live stats, checks them against
// the catalog, and persists newly-met unlocks (idempotent — safe to call
// after every workout save).
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { ACHIEVEMENTS } from './gamedata.js';

async function loadUnlocked() {
  const { data, error } = await sb.from('achievements').select('code, unlocked_at').eq('user_id', getUid());
  if (error) throw error;
  return data || [];
}

// Builds the { workoutsTotal, prsTotal, goalsTotal, prestige, isMaster, streak }
// stats object every achievement is measured against. `progress` is a loaded
// fitness_progress row; `streakCurrent` is streaks.computeStreak(...).current.
export async function loadStats(progress, streakCurrent) {
  const uid = getUid();
  const [wc, pc, gc] = await Promise.all([
    sb.from('workouts').select('id', { count: 'exact', head: true }).eq('user_id', uid),
    sb.from('personal_records').select('id', { count: 'exact', head: true }).eq('user_id', uid),
    sb.from('fitness_goals').select('id', { count: 'exact', head: true }).eq('user_id', uid).eq('achieved', true)
  ]);
  return {
    workoutsTotal: wc.count || 0,
    prsTotal: pc.count || 0,
    goalsTotal: gc.count || 0,
    prestige: progress.prestige,
    isMaster: progress.is_master ? 1 : 0,
    streak: streakCurrent || 0
  };
}

// The full catalog annotated with unlock state, for the Progress tab grid.
export async function loadAchievementsView(stats) {
  const unlocked = await loadUnlocked();
  const byCode = {};
  for (const u of unlocked) byCode[u.code] = u.unlocked_at;
  return ACHIEVEMENTS.map(a => {
    const value = stats[a.metric] || 0;
    return {
      ...a, value,
      unlocked: !!byCode[a.code],
      unlockedAt: byCode[a.code] || null,
      progressPct: Math.min(100, (value / a.target) * 100)
    };
  });
}

// Checks fresh stats against the catalog and persists any newly-met
// achievement. Returns award() events for whatever just unlocked so the
// caller can fold them into the same award() call as the workout/PR/goal XP.
export async function checkAchievements(stats) {
  const uid = getUid();
  const unlocked = await loadUnlocked();
  const already = new Set(unlocked.map(u => u.code));
  const newlyMet = ACHIEVEMENTS.filter(a => !already.has(a.code) && (stats[a.metric] || 0) >= a.target);
  if (!newlyMet.length) return [];

  // ON CONFLICT DO NOTHING (ignoreDuplicates) + RETURNING only the rows that
  // were actually inserted — makes this race-safe if called twice in quick
  // succession, and lets us award only for genuinely-new unlocks.
  const { data: inserted, error } = await sb.from('achievements')
    .upsert(newlyMet.map(a => ({ user_id: uid, code: a.code })), { onConflict: 'user_id,code', ignoreDuplicates: true })
    .select('code');
  if (error) return []; // best-effort — never block the workout save on this

  const insertedCodes = new Set((inserted || []).map(r => r.code));
  const confirmed = newlyMet.filter(a => insertedCodes.has(a.code));
  return confirmed.map(a => ({ type: 'achievement', label: a.label, xp: a.xp, plates: a.plates, code: a.code, icon: a.icon }));
}
