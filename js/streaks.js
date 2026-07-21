// Workout streaks: consecutive TRAINED WEEKS (Monday-based), with optional
// streak freezes (bought in the shop) that bridge a missed week. Freeze
// consumption is permanently recorded in streak_freeze_uses so recomputing
// the streak on every render can never spend the same freeze twice.
import { sb } from './supabase.js';
import { getUid } from './auth.js';
import { isoOf, todayISO } from './ui.js';

function weekStartOf(iso) {
  const d = new Date(iso + 'T00:00:00');
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return isoOf(d);
}
function shiftWeeks(weekStartIso, n) {
  const d = new Date(weekStartIso + 'T00:00:00');
  d.setDate(d.getDate() + n * 7);
  return isoOf(d);
}

// Longest run of consecutive Monday-week-starts in a sorted-ascending list.
function longestRun(sortedWeekStarts) {
  if (!sortedWeekStarts.length) return 0;
  let best = 1, run = 1;
  for (let i = 1; i < sortedWeekStarts.length; i++) {
    const prev = new Date(sortedWeekStarts[i - 1] + 'T00:00:00');
    const cur = new Date(sortedWeekStarts[i] + 'T00:00:00');
    const diffDays = Math.round((cur - prev) / 86400000);
    run = diffDays === 7 ? run + 1 : 1;
    if (run > best) best = run;
  }
  return best;
}

// `workouts` = the same array already loaded for the Training log (workout_date
// present on each). Returns { current, longest, freezesLeft }.
export async function computeStreak(workouts) {
  const uid = getUid();
  const weeksWithActivity = new Set(workouts.map(w => weekStartOf(w.workout_date)));
  const thisWeekStart = weekStartOf(todayISO());

  const [{ data: progress }, { data: freezeRows }] = await Promise.all([
    sb.from('fitness_progress').select('streak_freezes').eq('user_id', uid).maybeSingle(),
    sb.from('streak_freeze_uses').select('week_start').eq('user_id', uid)
  ]);
  let freezesLeft = Number(progress?.streak_freezes || 0);
  const usedWeeks = new Set((freezeRows || []).map(r => r.week_start));

  // Walk backward from "this week". An in-progress current week with no
  // activity yet shouldn't break the streak — only count it if it already
  // has activity, otherwise start the walk from last week.
  let cursor = weeksWithActivity.has(thisWeekStart) ? thisWeekStart : shiftWeeks(thisWeekStart, -1);

  let current = 0;
  const newFreezeUses = [];
  while (true) {
    if (weeksWithActivity.has(cursor) || usedWeeks.has(cursor)) {
      current++;
    } else if (freezesLeft > 0) {
      current++; freezesLeft--;
      newFreezeUses.push(cursor);
      usedWeeks.add(cursor);
    } else {
      break;
    }
    cursor = shiftWeeks(cursor, -1);
  }

  if (newFreezeUses.length) {
    try {
      await sb.from('streak_freeze_uses').insert(newFreezeUses.map(week_start => ({ user_id: uid, week_start })));
      await sb.from('fitness_progress').update({ streak_freezes: freezesLeft }).eq('user_id', uid);
    } catch { /* best-effort — worst case the same gap gets re-evaluated next render */ }
  }

  const goodWeeks = [...new Set([...weeksWithActivity, ...usedWeeks])].sort();
  const longest = Math.max(current, longestRun(goodWeeks));

  return { current, longest, freezesLeft };
}
