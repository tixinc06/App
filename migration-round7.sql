-- ============================================================================
-- MIGRATION: Round 7 — rest-timer background alerts (scheduled_pushes).
-- Run in Supabase SQL Editor.
-- ============================================================================
-- One more dashboard step beyond this SQL file — see the "SCHEDULED PUSH
-- SETUP" comment block near the end.

-- ── Scheduled pushes: a one-shot notification queued for a future time,
-- used by the rest timer so its completion alert can arrive even if the app
-- was fully closed before the rest finished. A cron job (set up below) polls
-- for due, unsent rows and sends them via the existing "push" edge function.
CREATE TABLE IF NOT EXISTS scheduled_pushes (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fire_at    TIMESTAMPTZ NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  tag        TEXT,
  sent_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE scheduled_pushes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own scheduled_pushes" ON scheduled_pushes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
-- Partial index: the cron sweep only ever looks at unsent rows, and there
-- are normally very few of them (one per in-flight rest timer).
CREATE INDEX IF NOT EXISTS idx_scheduled_pushes_due ON scheduled_pushes (fire_at) WHERE sent_at IS NULL;

-- ============================================================================
-- SCHEDULED PUSH SETUP (one-time, done in the Supabase dashboard)
-- ============================================================================
-- 1. Redeploy the "push" edge function with the updated
--    supabase/functions/push/index.ts (adds a `type:'scheduled'` branch —
--    no new secrets needed, reuses VAPID_PUBLIC/VAPID_PRIVATE/VAPID_SUBJECT/
--    PUSH_HOOK_SECRET already set up in migration-round4.sql).
-- 2. Database -> Cron Jobs (pg_cron) -> new job, every 15 SECONDS (pg_cron's
--    6-field syntax — seconds is the first field):
--      select cron.schedule(
--        'rest-timer-scheduled-pushes',
--        '*/15 * * * * *',
--        $$
--        select net.http_post(
--          url := 'https://<project-ref>.functions.supabase.co/push',
--          headers := jsonb_build_object('Content-Type','application/json','x-push-secret','<PUSH_HOOK_SECRET>'),
--          body := jsonb_build_object('type','scheduled')
--        );
--        $$
--      );
--    (If the dashboard's Cron Jobs UI doesn't accept a 6-field schedule,
--    run the `cron.schedule(...)` call above directly in the SQL Editor.)
