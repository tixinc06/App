-- ============================================================================
-- MIGRATION: Fitness — rest timer, exercise library, XP cooldown (Phase FG-7)
-- run in Supabase SQL Editor.
-- ============================================================================

-- 10h cooldown after a workout awards XP — blocks ALL further fitness
-- XP/Plates (workout/PR/goal/quest/achievement) until it expires.
ALTER TABLE fitness_progress ADD COLUMN IF NOT EXISTS xp_cooldown_until TIMESTAMPTZ;

-- A user's own saved exercises, shown alongside the premade catalog
-- (js/exercises.js) in the workout builder / template editor picker.
CREATE TABLE IF NOT EXISTS custom_exercises (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, name)
);
ALTER TABLE custom_exercises ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own custom_exercises" ON custom_exercises
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
