-- ============================================================================
-- MIGRATION: Fitness — Friends & social (Phase FG-5) — run in Supabase SQL Editor.
-- ============================================================================

-- One row per user: a public username so friends can find each other.
-- Username/display_name are NOT sensitive (no stats), so SELECT is public —
-- that's what makes "add by username" search possible.
CREATE TABLE IF NOT EXISTS profiles (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles are publicly readable" ON profiles
  FOR SELECT USING (true);
CREATE POLICY "insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = user_id);

-- Friend requests / friendships. requester sends, addressee accepts.
CREATE TABLE IF NOT EXISTS friendships (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at     TIMESTAMPTZ DEFAULT now(),
  CHECK (requester_id <> addressee_id)
);

ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own friendships" ON friendships
  FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
CREATE POLICY "send friend request" ON friendships
  FOR INSERT WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "respond to friend request" ON friendships
  FOR UPDATE USING (auth.uid() = addressee_id OR auth.uid() = requester_id);
CREATE POLICY "remove friendship" ON friendships
  FOR DELETE USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
CREATE INDEX IF NOT EXISTS idx_friendships_requester ON friendships (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_friendships_addressee ON friendships (addressee_id, status);

-- Let an ACCEPTED friend view your level/prestige/XP row (for leaderboards) and
-- your goals (open + achieved). These are additive SELECT-only policies — the
-- existing "own" FOR ALL policies on these tables are untouched, and Postgres
-- OR's multiple permissive policies together, so you can still do everything to
-- your own rows and friends can only ever SELECT.
CREATE POLICY "friends can view progress" ON fitness_progress
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND ((f.requester_id = auth.uid() AND f.addressee_id = fitness_progress.user_id)
          OR (f.addressee_id = auth.uid() AND f.requester_id = fitness_progress.user_id))
    )
  );

CREATE POLICY "friends can view goals" ON fitness_goals
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND ((f.requester_id = auth.uid() AND f.addressee_id = fitness_goals.user_id)
          OR (f.addressee_id = auth.uid() AND f.requester_id = fitness_goals.user_id))
    )
  );

-- Workout templates can be opted into sharing; friends can then view + copy them.
ALTER TABLE workout_templates ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT false;

CREATE POLICY "friends can view shared templates" ON workout_templates
  FOR SELECT USING (
    is_shared = true
    AND EXISTS (
      SELECT 1 FROM friendships f
      WHERE f.status = 'accepted'
        AND ((f.requester_id = auth.uid() AND f.addressee_id = workout_templates.user_id)
          OR (f.addressee_id = auth.uid() AND f.requester_id = workout_templates.user_id))
    )
  );
