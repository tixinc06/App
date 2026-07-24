// The progression engine: XP/Plates awards, level-up rolling, manual prestige,
// PR detection (estimated 1RM via Epley), and goal-completion checks. No UI —
// js/progress.js renders the Progress tab on top of this.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import * as GD from './gamedata.js';

// Fetch the user's progress row, lazily creating it on first use.
export async function loadProgress() {
  const uid = getUid();
  const { data, error } = await sb.from('fitness_progress').select('*').eq('user_id', uid).maybeSingle();
  if (error) throw error;
  if (data) return data;
  const ins = await sb.from('fitness_progress').insert({ user_id: uid }).select().single();
  if (ins.error) throw ins.error;
  return ins.data;
}

// Returns the cooldown expiry Date if XP/Plates are currently blocked, else
// null. Callers that persist a one-time side effect on award (quest claims,
// achievement unlocks) MUST check this BEFORE persisting anything — award()
// itself refuses to grant XP during cooldown, so persisting first would burn
// the one-time claim/unlock with no reward.
export async function isOnCooldown() {
  const progress = await loadProgress();
  if (progress.xp_cooldown_until && new Date(progress.xp_cooldown_until) > new Date()) {
    return new Date(progress.xp_cooldown_until);
  }
  return null;
}

export function xpToNext(progress) {
  return progress.is_master ? GD.xpForMasterLevel(progress.level) : GD.xpForLevel(progress.level);
}

export function maxLevelForTrack(progress) {
  return progress.is_master ? GD.MASTER_MAX_LEVEL : GD.LEVELS_PER_PRESTIGE;
}

// Roll any level-ups the current XP balance affords, persisting the result.
async function rollLevels(progress) {
  let xp = Number(progress.xp), level = progress.level;
  let levelsGained = 0;
  const cap = maxLevelForTrack(progress);
  while (level < cap) {
    const need = progress.is_master ? GD.xpForMasterLevel(level) : GD.xpForLevel(level);
    if (xp < need) break;
    xp -= need;
    level += 1;
    levelsGained += 1;
  }
  if (levelsGained === 0) return { progress, levelsGained: 0 };
  const { data, error } = await sb.from('fitness_progress')
    .update({ xp, level }).eq('user_id', progress.user_id).select().single();
  if (error) throw error;
  return { progress: data, levelsGained };
}

// Award XP/Plates for a batch of events, e.g.
//   [{type:'workout', sets:12}, {type:'pr', exercise:'Bench Press'}, {type:'goal', exercise:'Squat'}]
// Persists to fitness_progress, rolls any level-ups, and returns a summary.
// Returns null if there was nothing to award (empty/unrecognised events).
export async function award(events) {
  const progress = await loadProgress();
  if (progress.xp_cooldown_until && new Date(progress.xp_cooldown_until) > new Date()) {
    return { onCooldown: true, until: progress.xp_cooldown_until };
  }
  let xpGain = 0, platesGain = 0;
  const labels = [];
  for (const e of events) {
    if (e.type === 'workout') {
      xpGain += GD.XP_PER_WORKOUT_BASE + (e.sets || 0) * GD.XP_PER_SET;
      platesGain += GD.PLATES_PER_WORKOUT_BASE + (e.sets || 0) * GD.PLATES_PER_SET;
      labels.push('Workout');
    } else if (e.type === 'pr') {
      xpGain += GD.XP_PER_PR; platesGain += GD.PLATES_PER_PR;
      labels.push(`PR: ${e.exercise}`);
    } else if (e.type === 'goal') {
      xpGain += GD.XP_PER_GOAL; platesGain += GD.PLATES_PER_GOAL;
      labels.push(`Goal: ${e.exercise}`);
    } else if (e.type === 'quest' || e.type === 'achievement') {
      // Quests/achievements carry their own pre-computed XP/Plates (from the
      // catalog in gamedata.js) rather than a formula — this branch just
      // folds them into the same booster + level-roll pipeline as everything else.
      xpGain += e.xp || 0; platesGain += e.plates || 0;
      labels.push(`${e.type === 'quest' ? 'Quest' : 'Achievement'}: ${e.label}`);
    }
  }
  if (xpGain === 0 && platesGain === 0) return null;

  // Apply an active XP booster from the shop, if any (best-effort — a missing
  // user_settings table/row just means no boost, not a failure).
  let boosterApplied = null;
  try {
    const { data: settings } = await sb.from('user_settings')
      .select('active_booster').eq('user_id', progress.user_id).maybeSingle();
    const booster = settings?.active_booster;
    if (booster && new Date(booster.expires_at) > new Date()) {
      xpGain = Math.round(xpGain * booster.multiplier);
      boosterApplied = booster.multiplier;
    }
  } catch { /* no booster available */ }

  // Weekend event: applied AFTER any booster, so a 2x booster during the
  // Fri-Sun window compounds to 4x XP (Plates only ever get the flat 2x —
  // boosters are XP-only by design).
  const eventApplied = GD.isDoubleWeekend();
  if (eventApplied) {
    xpGain = Math.round(xpGain * 2);
    platesGain = Math.round(platesGain * 2);
  }

  const updatePayload = {
    xp: Number(progress.xp) + xpGain,
    plates: Number(progress.plates) + platesGain,
    lifetime_xp: Number(progress.lifetime_xp) + xpGain
  };
  // Only a workout event (re)sets the cooldown — claiming a quest or
  // unlocking an achievement on its own doesn't extend it.
  if (events.some(e => e.type === 'workout')) {
    updatePayload.xp_cooldown_until = new Date(Date.now() + 10 * 3600 * 1000).toISOString();
  }

  const { data, error } = await sb.from('fitness_progress').update(updatePayload)
    .eq('user_id', progress.user_id).select().single();
  if (error) throw error;

  const rolled = await rollLevels(data);
  return { xpGain, platesGain, labels, levelsGained: rolled.levelsGained, progress: rolled.progress, boosterApplied, eventApplied };
}

// Manual prestige — only allowed once the level cap (55) is reached on the
// normal track. The 10th prestige unlocks Master Prestige (levels 1-1000)
// instead of a normal reset.
export async function prestige() {
  const progress = await loadProgress();
  if (progress.is_master) throw new Error('Already in Master Prestige.');
  if (progress.level < GD.LEVELS_PER_PRESTIGE) throw new Error(`Reach level ${GD.LEVELS_PER_PRESTIGE} first.`);

  const nextPrestige = progress.prestige + 1;
  const enteringMaster = nextPrestige >= GD.MAX_PRESTIGE;
  const patch = enteringMaster
    ? { prestige: GD.MAX_PRESTIGE, level: 1, xp: 0, is_master: true }
    : { prestige: nextPrestige, level: 1, xp: 0 };

  const { data, error } = await sb.from('fitness_progress')
    .update(patch).eq('user_id', progress.user_id).select().single();
  if (error) throw error;
  return { progress: data, enteredMaster: enteringMaster };
}

// ── Personal records ─────────────────────────────────────────────────────────
// Epley formula: a standard, widely-used estimated-1RM approximation. Exported
// so the live in-session PR medal (js/fitness.js) and the exercise detail
// page's history chart (js/exercisedetail.js) share the exact same formula
// the authoritative save-time PR detection below uses.
export function estimatedE1RM(weight, reps) {
  if (!weight || !reps) return 0;
  return weight * (1 + reps / 30);
}

// Given a just-saved workout's exercises, find each exercise's best set (by
// estimated 1RM), and if it beats the stored PR, upsert personal_records.
// Returns PR events suitable for award().
export async function detectAndSavePRs(exercises) {
  const uid = getUid();
  const prEvents = [];
  for (const ex of exercises) {
    if (!ex.name || !ex.sets?.length) continue;
    let bestSet = null, bestE1rm = 0;
    for (const s of ex.sets) {
      const e1rm = estimatedE1RM(Number(s.weight) || 0, Number(s.reps) || 0);
      if (e1rm > bestE1rm) { bestE1rm = e1rm; bestSet = s; }
    }
    if (!bestSet || bestE1rm <= 0) continue;

    const { data: existing, error: selErr } = await sb.from('personal_records')
      .select('best_e1rm').eq('user_id', uid).eq('exercise', ex.name).maybeSingle();
    if (selErr) continue;

    if (!existing || bestE1rm > Number(existing.best_e1rm)) {
      const { error } = await sb.from('personal_records').upsert({
        user_id: uid, exercise: ex.name,
        best_weight: bestSet.weight, best_reps: bestSet.reps, best_e1rm: bestE1rm,
        achieved_at: new Date().toISOString()
      }, { onConflict: 'user_id,exercise' });
      if (!error) prEvents.push({ type: 'pr', exercise: ex.name });
    }
  }
  return prEvents;
}

// ── Goals ─────────────────────────────────────────────────────────────────────
// Re-check all open goals against current PRs; mark newly-met ones achieved
// and return goal events suitable for award().
export async function checkGoals() {
  const uid = getUid();
  const [{ data: goals, error: gErr }, { data: prs, error: pErr }] = await Promise.all([
    sb.from('fitness_goals').select('*').eq('user_id', uid).eq('achieved', false),
    sb.from('personal_records').select('*').eq('user_id', uid)
  ]);
  if (gErr) throw gErr;
  if (pErr) throw pErr;

  const prByExercise = {};
  for (const p of (prs || [])) prByExercise[p.exercise] = p;

  const goalEvents = [];
  for (const goal of (goals || [])) {
    const pr = prByExercise[goal.exercise];
    if (!pr) continue;
    const meetsWeight = Number(pr.best_weight) >= Number(goal.target_weight);
    const meetsReps = !goal.target_reps || Number(pr.best_reps) >= Number(goal.target_reps);
    if (meetsWeight && meetsReps) {
      const { error } = await sb.from('fitness_goals')
        .update({ achieved: true, achieved_at: new Date().toISOString() }).eq('id', goal.id);
      if (!error) goalEvents.push({ type: 'goal', exercise: goal.exercise });
    }
  }
  return goalEvents;
}
