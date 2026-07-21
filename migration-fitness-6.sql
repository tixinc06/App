-- ============================================================================
-- MIGRATION: Fitness — Quests, streaks, achievements & prestige titles
-- (Phase FG-6) — run in Supabase SQL Editor.
-- ============================================================================

-- Owned-but-unused streak freezes (bought in the shop; consumed automatically
-- to bridge a missed training week without breaking your streak).
ALTER TABLE fitness_progress ADD COLUMN IF NOT EXISTS streak_freezes INTEGER NOT NULL DEFAULT 0;

-- Permanent ledger of which weeks were bridged by a freeze, so the same
-- freeze can never be re-applied and streak history stays consistent no
-- matter how many times it's recomputed.
CREATE TABLE IF NOT EXISTS streak_freeze_uses (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, week_start)
);
ALTER TABLE streak_freeze_uses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own streak_freeze_uses" ON streak_freeze_uses
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- One row per claimed quest per period (e.g. quest_code='weekly_3_workouts',
-- period_key='2026-W29'). Quest definitions themselves live in gamedata.js —
-- this table only records what's already been claimed, to prevent re-claiming.
CREATE TABLE IF NOT EXISTS quest_claims (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_code  TEXT NOT NULL,
  period_key  TEXT NOT NULL,
  claimed_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, quest_code, period_key)
);
ALTER TABLE quest_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own quest_claims" ON quest_claims
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- One row per unlocked achievement. Catalog (labels, icons, requirements,
-- XP/Plate rewards) lives in gamedata.js; this table only records unlocks.
CREATE TABLE IF NOT EXISTS achievements (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  unlocked_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, code)
);
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own achievements" ON achievements
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
