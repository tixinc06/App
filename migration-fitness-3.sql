-- ============================================================================
-- MIGRATION: Fitness — shop, cosmetics & theme engine — run in Supabase SQL Editor.
-- ============================================================================

-- Permanent cosmetic unlocks (themes + banners). Boosters are instant-use and
-- don't get an inventory row — see user_settings.active_booster below.
CREATE TABLE IF NOT EXISTS user_inventory (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_code   TEXT NOT NULL,
  item_type   TEXT NOT NULL CHECK (item_type IN ('theme', 'banner')),
  acquired_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, item_code)
);

ALTER TABLE user_inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own user_inventory" ON user_inventory
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- One row per user: equipped cosmetics + any currently-active XP booster.
CREATE TABLE IF NOT EXISTS user_settings (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  equipped_theme  TEXT NOT NULL DEFAULT 'default',
  equipped_banner TEXT,
  active_booster  JSONB,  -- {multiplier, expires_at, code}
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own user_settings" ON user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
