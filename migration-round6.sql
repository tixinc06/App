-- ============================================================================
-- MIGRATION: Round 6 — recipes, water tracking, weight units, currency,
-- notification reminders. Run in Supabase SQL Editor.
-- ============================================================================
-- Reminders need one more dashboard step beyond this SQL file — see the
-- "REMINDERS SETUP" comment block near the end.

-- ── Recipes (a saved combination of foods, logged as one entry) ─────────────
CREATE TABLE IF NOT EXISTS recipes (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  items      JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{food_id, food_name, servings}]
  calories   NUMERIC NOT NULL DEFAULT 0,           -- totals snapshot (servings already applied)
  protein    NUMERIC NOT NULL DEFAULT 0,
  carbs      NUMERIC NOT NULL DEFAULT 0,
  fat        NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own recipes" ON recipes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes (user_id, name);

-- ── Water tracking (one row per day, upserted) ───────────────────────────────
CREATE TABLE IF NOT EXISTS water_logs (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  log_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  amount_ml  INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, log_date)
);
ALTER TABLE water_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own water_logs" ON water_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_water_logs_user_date ON water_logs (user_id, log_date DESC);

-- ── Settings: water goal, weight unit, currency, reminders, timezone ────────
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS water_goal_ml INTEGER;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS weight_unit TEXT NOT NULL DEFAULT 'kg' CHECK (weight_unit IN ('kg', 'lb'));
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT '£';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS reminder_prefs JSONB;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS timezone TEXT;

-- ============================================================================
-- REMINDERS SETUP (one-time, done in the Supabase dashboard)
-- ============================================================================
-- 1. Redeploy the "push" edge function with the updated
--    supabase/functions/push/index.ts (adds a `type:'reminders'` branch —
--    no new secrets needed, reuses VAPID_PUBLIC/VAPID_PRIVATE/VAPID_SUBJECT/
--    PUSH_HOOK_SECRET already set up in migration-round4.sql).
-- 2. Database -> Cron Jobs (pg_cron) -> new job, every 30 minutes:
--      select net.http_post(
--        url := 'https://<project-ref>.functions.supabase.co/push',
--        headers := jsonb_build_object('Content-Type','application/json','x-push-secret','<PUSH_HOOK_SECRET>'),
--        body := jsonb_build_object('type','reminders')
--      );
