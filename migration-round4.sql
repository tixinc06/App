-- ============================================================================
-- MIGRATION: Round 4 — push notifications, body measurements + progress
-- photos, rank-up tracking. Run in Supabase SQL Editor.
-- ============================================================================
-- Push notification setup is dashboard work beyond this SQL file — see the
-- "PUSH SETUP" comment block near the end for the exact one-time steps
-- (VAPID secrets, the edge function, Database Webhooks, pg_cron).

-- ── Push subscriptions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint      TEXT NOT NULL UNIQUE,
  subscription  JSONB NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own push_subscriptions" ON push_subscriptions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions (user_id);

-- Per-type notification opt-outs. Null/missing key = on by default.
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notif_prefs JSONB;

-- ── Body measurements ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS body_measurements (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  values      JSONB NOT NULL DEFAULT '{}'::jsonb,  -- {waist, chest, left_arm, ...} — see gamedata.js
  note        TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE body_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own body_measurements" ON body_measurements
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_body_measurements_user_date ON body_measurements (user_id, entry_date DESC);

-- ── Progress photos ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS progress_photos (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  taken_on      DATE NOT NULL DEFAULT CURRENT_DATE,
  storage_path  TEXT NOT NULL,
  weight        NUMERIC,
  note          TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE progress_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own progress_photos" ON progress_photos
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_progress_photos_user_date ON progress_photos (user_id, taken_on DESC);

-- Private bucket — never public. Photos are read via short-lived signed URLs
-- (see js/progress.js), mirroring the existing resell-photos pattern.
INSERT INTO storage.buckets (id, name, public)
VALUES ('progress-photos', 'progress-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "own progress photos read" ON storage.objects FOR SELECT
  USING (bucket_id = 'progress-photos' AND owner = auth.uid());
CREATE POLICY "own progress photos insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'progress-photos' AND owner = auth.uid());
CREATE POLICY "own progress photos delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'progress-photos' AND owner = auth.uid());

-- Public bucket used ONLY for the explicit "Share to a friend" action — a
-- deliberate opt-in copy of one photo, never the private original.
INSERT INTO storage.buckets (id, name, public)
VALUES ('progress-shares', 'progress-shares', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read progress shares" ON storage.objects FOR SELECT
  USING (bucket_id = 'progress-shares');
CREATE POLICY "own progress share insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'progress-shares' AND owner = auth.uid());
CREATE POLICY "own progress share delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'progress-shares' AND owner = auth.uid());

-- ── Rank-up celebration ──────────────────────────────────────────────────────
-- The last division label the user was shown a celebration for, so the
-- client can detect an INCREASE without re-deriving history.
ALTER TABLE fitness_progress ADD COLUMN IF NOT EXISTS rank_label TEXT;

-- ============================================================================
-- PUSH SETUP (one-time, done in the Supabase dashboard — not plain SQL)
-- ============================================================================
-- 1. Project Settings -> Edge Functions -> Secrets, add:
--      VAPID_PUBLIC     = (the public key already pasted into js/config.js)
--      VAPID_PRIVATE    = (given to you separately — never commit this)
--      VAPID_SUBJECT    = mailto:you@example.com
--      PUSH_HOOK_SECRET = any random string you choose (shared secret so
--                          only your own webhooks/cron can call the function)
-- 2. Edge Functions -> Create a new function named "push", paste the
--    contents of supabase/functions/push/index.ts, deploy.
-- 3. Database -> Webhooks -> Create webhook:
--      Table: messages, Event: INSERT
--      Type: HTTP Request -> POST to the push function's URL
--      Header: x-push-secret: <PUSH_HOOK_SECRET>
--      Body (HTTP Request payload): {"type":"messages","record":{{record}}}
--    Repeat for:
--      Table: friendships, Event: INSERT, same header,
--      Body: {"type":"friend_requests","record":{{record}}}
-- 4. Database -> Cron Jobs (pg_cron) -> new job, daily ~18:00, running:
--      select net.http_post(
--        url := 'https://<project-ref>.functions.supabase.co/push',
--        headers := jsonb_build_object('Content-Type','application/json','x-push-secret','<PUSH_HOOK_SECRET>'),
--        body := jsonb_build_object('type','streak')
--      );
--    (requires the pg_net extension, enabled by default on most projects —
--    Database -> Extensions -> pg_net if it's missing)
