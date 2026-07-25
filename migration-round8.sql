-- ============================================================================
-- MIGRATION: Round 8 — faster rest-timer push delivery. Run in Supabase SQL
-- Editor. NO SCHEMA CHANGES — this file is dashboard/cron instructions only.
-- ============================================================================
-- Round 7 set up a pg_cron job that polls scheduled_pushes every 15 seconds,
-- so a closed-app rest-timer notification could arrive up to ~15s late. This
-- replaces it with a job that runs every 5 SECONDS but only actually invokes
-- the edge function when a row is genuinely due — an unconditional 5s cron
-- would be ~518k invocations/month (over Supabase's 500k free-tier limit);
-- this conditional form costs roughly one invocation per completed rest.

-- 1. Remove the Round 7 job (adjust the name if you changed it on setup):
--      select cron.unschedule('rest-timer-scheduled-pushes');

-- 2. Add the replacement — every 5 seconds, but gated by an EXISTS check that
--    runs cheaply in Postgres and only fires the HTTP call when needed:
--      select cron.schedule(
--        'rest-timer-scheduled-pushes',
--        '*/5 * * * * *',
--        $$
--        select net.http_post(
--          url := 'https://<project-ref>.functions.supabase.co/push',
--          headers := jsonb_build_object('Content-Type','application/json','x-push-secret','<PUSH_HOOK_SECRET>'),
--          body := jsonb_build_object('type','scheduled')
--        )
--        where exists (
--          select 1 from scheduled_pushes where sent_at is null and fire_at <= now()
--        );
--        $$
--      );

-- No edge-function redeploy is needed for this step — supabase/functions/push/index.ts's
-- `scheduled` branch is unchanged; only the cron schedule/condition changes.

-- Honest limit (unchanged from Round 7): with the app fully killed, iOS still
-- delivers the push SILENTLY and without vibration (no Vibration API, no
-- notification-sound setting for web apps) — this only tightens how quickly
-- it arrives, not what it can do once it lands. The full alarm experience
-- (loud even with the ringer off, vibration, full-screen flash) only fires
-- while the app is open, which js/sound.js + js/resttimer.js now handle.
