// Weekly quests: bonus XP/Plates for hitting a target this week (train N
// times, hit a PR, achieve a goal). Progress is computed live from data
// already loaded elsewhere; claiming is a one-time action per quest per
// week, recorded in quest_claims so it can't be claimed twice.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { todayISO, isoOf } from './ui.js';
import { QUESTS } from './gamedata.js';
import { award } from './progression.js';

function weekStartOf(iso) {
  const d = new Date(iso + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return isoOf(d);
}
function weekEndOf(weekStartIso) {
  const d = new Date(weekStartIso + 'T00:00:00');
  d.setDate(d.getDate() + 6);
  return isoOf(d);
}

// `workouts`/`prs`/`goals` are the same arrays already loaded for the Train/
// Progress tabs (each item has workout_date or achieved_at respectively).
export async function loadQuestProgress(workouts, prs, goals) {
  const uid = getUid();
  const weekStart = weekStartOf(todayISO());
  const weekEnd = weekEndOf(weekStart);
  const inWeek = iso => !!iso && iso >= weekStart && iso <= weekEnd;

  const counts = {
    workouts: workouts.filter(w => inWeek(w.workout_date)).length,
    prs: prs.filter(p => inWeek((p.achieved_at || '').slice(0, 10))).length,
    goals: goals.filter(g => g.achieved && inWeek((g.achieved_at || '').slice(0, 10))).length
  };

  const { data: claims, error } = await sb.from('quest_claims')
    .select('quest_code').eq('user_id', uid).eq('period_key', weekStart);
  if (error) throw error;
  const claimedCodes = new Set((claims || []).map(c => c.quest_code));

  const quests = QUESTS.map(q => {
    const progress = Math.min(q.target, counts[q.metric] || 0);
    return { ...q, progress, completed: progress >= q.target, claimed: claimedCodes.has(q.code) };
  });
  return { weekStart, quests };
}

export async function claimQuest(quest, weekStart) {
  const uid = getUid();
  const { error } = await sb.from('quest_claims')
    .insert({ user_id: uid, quest_code: quest.code, period_key: weekStart });
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('Already claimed.');
    throw error;
  }
  return award([{ type: 'quest', label: quest.label, xp: quest.xp, plates: quest.plates }]);
}
