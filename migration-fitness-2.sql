-- ============================================================================
-- MIGRATION: Fitness — progression engine (XP, Plates, level, prestige,
-- PRs, goals) — run in Supabase SQL Editor.
-- ============================================================================

-- One row per user: level/XP/prestige/currency state.
CREATE TABLE IF NOT EXISTS fitness_progress (
  user_id     UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  xp          NUMERIC NOT NULL DEFAULT 0,
  level       INTEGER NOT NULL DEFAULT 1,
  prestige    INTEGER NOT NULL DEFAULT 0,
  is_master   BOOLEAN NOT NULL DEFAULT false,
  plates      INTEGER NOT NULL DEFAULT 0,
  lifetime_xp NUMERIC NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE fitness_progress ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own fitness_progress" ON fitness_progress
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Best estimated-1RM per exercise (Epley formula, computed client-side).
CREATE TABLE IF NOT EXISTS personal_records (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise    TEXT NOT NULL,
  best_weight NUMERIC NOT NULL DEFAULT 0,
  best_reps   INTEGER NOT NULL DEFAULT 0,
  best_e1rm   NUMERIC NOT NULL DEFAULT 0,
  achieved_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, exercise)
);

ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own personal_records" ON personal_records
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_pr_user ON personal_records (user_id, best_e1rm DESC);

-- User-set lift goals, e.g. "100kg bench for 1 rep".
CREATE TABLE IF NOT EXISTS fitness_goals (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise      TEXT NOT NULL,
  target_weight NUMERIC NOT NULL,
  target_reps   INTEGER NOT NULL DEFAULT 1,
  achieved      BOOLEAN NOT NULL DEFAULT false,
  achieved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE fitness_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own fitness_goals" ON fitness_goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_goals_user ON fitness_goals (user_id, achieved, created_at DESC);
