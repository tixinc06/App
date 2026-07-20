-- ============================================================================
-- MIGRATION: Fitness — custom workouts + splits — run in Supabase SQL Editor
-- Adds reusable workout templates and named splits that schedule them across
-- the week, powering the new "Today" card and preset splits (PPL, Upper/
-- Lower, Full Body) in the Fitness tab.
-- ============================================================================

CREATE TABLE IF NOT EXISTS workout_templates (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  exercises  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{name, sets, reps}] — targets, not logged performance
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE workout_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own workout_templates" ON workout_templates
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_workout_templates_user ON workout_templates (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS splits (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  schedule   JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {"0":template_id,...} 0=Sun..6=Sat; missing/null = rest
  is_active  BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE splits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own splits" ON splits
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_splits_user ON splits (user_id, created_at DESC);
