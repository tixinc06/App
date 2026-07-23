-- ============================================================================
-- MIGRATION: Round 3 — booster ownership, weight-planner stats, profile
-- photos, barcode memory, and friend messaging. Run in Supabase SQL Editor.
-- ============================================================================

-- ── 1/2 — Boosters become owned (buy → store → activate) ────────────────────
ALTER TABLE user_inventory DROP CONSTRAINT IF EXISTS user_inventory_item_type_check;
ALTER TABLE user_inventory ADD CONSTRAINT user_inventory_item_type_check
  CHECK (item_type IN ('theme', 'banner', 'booster'));
ALTER TABLE user_inventory ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

-- ── 5 — TDEE weight planner: private body stats + calorie target ────────────
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS height_cm NUMERIC;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS sex TEXT CHECK (sex IN ('male', 'female'));
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS activity_level NUMERIC;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS goal_weight NUMERIC;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS calorie_target NUMERIC;

-- ── 4 — Barcode memory on the food library ───────────────────────────────────
ALTER TABLE foods ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods (user_id, barcode);

-- ── 6 — Uploadable profile photos ────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read avatars" ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');
CREATE POLICY "own avatar insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND owner = auth.uid());
CREATE POLICY "own avatar delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND owner = auth.uid());

-- ── 7 — Friend messaging ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION are_friends(a UUID, b UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM friendships f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = a AND f.addressee_id = b) OR (f.requester_id = b AND f.addressee_id = a))
  );
$$;
REVOKE ALL ON FUNCTION are_friends(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION are_friends(UUID, UUID) TO authenticated;

CREATE TABLE IF NOT EXISTS messages (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  recipient_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body          TEXT DEFAULT '',
  attachment    JSONB,
  created_at    TIMESTAMPTZ DEFAULT now(),
  read_at       TIMESTAMPTZ,
  CHECK (sender_id <> recipient_id)
);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own messages" ON messages
  FOR SELECT USING (auth.uid() = sender_id OR auth.uid() = recipient_id);
CREATE POLICY "send message to a friend" ON messages
  FOR INSERT WITH CHECK (
    auth.uid() = sender_id
    AND are_friends(sender_id, recipient_id)
    AND NOT is_banned(auth.uid())
  );
CREATE POLICY "recipient marks read" ON messages
  FOR UPDATE USING (auth.uid() = recipient_id) WITH CHECK (auth.uid() = recipient_id);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages (sender_id, recipient_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_recipient_unread ON messages (recipient_id, read_at);

-- Enable Realtime on messages (live delivery). If this errors because it's
-- already in the publication, that's fine — ignore and continue.
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
