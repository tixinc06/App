-- ============================================================================
-- Tracker app — database schema
-- Run this in your NEW Supabase project:  Dashboard → SQL Editor → New query →
-- paste everything → Run.
--
-- Every table is private per user: Row-Level Security is enabled and each policy
-- restricts rows to user_id = auth.uid(). One user can never see another's data.
-- ============================================================================

-- ── Reselling: inventory ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resell_items (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  category      TEXT DEFAULT '',
  photo_url     TEXT,
  cost          NUMERIC NOT NULL DEFAULT 0,
  source        TEXT DEFAULT '',
  purchase_date DATE,
  status        TEXT NOT NULL DEFAULT 'in_stock'
                  CHECK (status IN ('in_stock', 'listed', 'sold')),
  list_price    NUMERIC,
  notes         TEXT DEFAULT '',
  product_url   TEXT,
  quantity      INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE resell_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own resell_items" ON resell_items
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_resell_items_user ON resell_items (user_id, created_at DESC);

-- ── Reselling: sales ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS resell_sales (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  item_id       UUID REFERENCES resell_items(id) ON DELETE SET NULL,
  sale_price    NUMERIC NOT NULL DEFAULT 0,
  platform      TEXT DEFAULT '',
  fees          NUMERIC NOT NULL DEFAULT 0,
  shipping_cost NUMERIC NOT NULL DEFAULT 0,
  cost_snapshot NUMERIC NOT NULL DEFAULT 0,   -- item cost at time of sale
  item_name     TEXT DEFAULT '',              -- name snapshot (survives item deletion)
  sold_date     DATE,
  quantity      INTEGER NOT NULL DEFAULT 1,
  returned      BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE resell_sales ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own resell_sales" ON resell_sales
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_resell_sales_user ON resell_sales (user_id, sold_date DESC);

-- ── Food: reusable library ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS foods (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  serving_desc TEXT DEFAULT '',
  calories     NUMERIC NOT NULL DEFAULT 0,
  protein      NUMERIC NOT NULL DEFAULT 0,
  carbs        NUMERIC NOT NULL DEFAULT 0,
  fat          NUMERIC NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE foods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own foods" ON foods
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_foods_user ON foods (user_id, name);

-- ── Food: daily log (stores a macro snapshot so history is stable) ──────────
CREATE TABLE IF NOT EXISTS food_logs (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  food_id    UUID REFERENCES foods(id) ON DELETE SET NULL,
  food_name  TEXT DEFAULT '',
  log_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  servings   NUMERIC NOT NULL DEFAULT 1,
  calories   NUMERIC NOT NULL DEFAULT 0,   -- snapshot: per-serving × servings baked in
  protein    NUMERIC NOT NULL DEFAULT 0,
  carbs      NUMERIC NOT NULL DEFAULT 0,
  fat        NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE food_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own food_logs" ON food_logs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_food_logs_user_date ON food_logs (user_id, log_date DESC);

-- ── Fitness: workouts (exercises/sets stored as JSONB) ──────────────────────
CREATE TABLE IF NOT EXISTS workouts (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_date DATE NOT NULL DEFAULT CURRENT_DATE,
  name         TEXT DEFAULT '',
  notes        TEXT DEFAULT '',
  exercises    JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{name, sets:[{weight,reps}]}]
  created_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE workouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own workouts" ON workouts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_workouts_user_date ON workouts (user_id, workout_date DESC);

-- ── Fitness: bodyweight entries ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS weight_entries (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  weight     NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE weight_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own weight_entries" ON weight_entries
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_weight_user_date ON weight_entries (user_id, entry_date DESC);

-- ── Fitness: reusable workout templates ─────────────────────────────────────
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

-- ── Fitness: splits (schedule templates across the week) ────────────────────
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

-- ── Fitness: progression (level/XP/prestige/Plates), one row per user ───────
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

-- ── Fitness: personal records (best estimated-1RM per exercise) ─────────────
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

-- ── Fitness: user-set lift goals ─────────────────────────────────────────────
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

-- ── Fitness: shop inventory (permanent theme/banner unlocks) ────────────────
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

-- ── Fitness: user settings (equipped cosmetics + active XP booster) ─────────
CREATE TABLE IF NOT EXISTS user_settings (
  user_id         UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  equipped_theme  TEXT NOT NULL DEFAULT 'default',
  equipped_banner TEXT,
  active_booster  JSONB,
  updated_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own user_settings" ON user_settings
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Reselling: expenses (postage, packaging, subscriptions, fees…) ──────────
CREATE TABLE IF NOT EXISTS resell_expenses (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category      TEXT DEFAULT '',
  amount        NUMERIC NOT NULL DEFAULT 0,
  expense_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  note          TEXT DEFAULT '',
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE resell_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own resell_expenses" ON resell_expenses
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_resell_expenses_user ON resell_expenses (user_id, expense_date DESC);

-- ── Reselling: product catalog (shared community + personal sourcing list) ──
CREATE TABLE IF NOT EXISTS product_catalog (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id       UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  image_url     TEXT,
  product_url   TEXT,
  default_cost  NUMERIC,
  category      TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  is_shared     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE product_catalog ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view shared or own products" ON product_catalog
  FOR SELECT USING (is_shared = true OR auth.uid() = user_id);
CREATE POLICY "insert own products" ON product_catalog
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own products" ON product_catalog
  FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "delete own products" ON product_catalog
  FOR DELETE USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_product_catalog_shared ON product_catalog (is_shared, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_catalog_user ON product_catalog (user_id, created_at DESC);

-- ============================================================================
-- OPTIONAL: inventory photo storage
-- Run this only if you want to upload item photos. Creates a private bucket and
-- restricts each user to their own folder (named by their user id).
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('resell-photos', 'resell-photos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "own photos read" ON storage.objects FOR SELECT
  USING (bucket_id = 'resell-photos' AND owner = auth.uid());
CREATE POLICY "own photos insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'resell-photos' AND owner = auth.uid());
CREATE POLICY "own photos delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'resell-photos' AND owner = auth.uid());

-- ============================================================================
-- OPTIONAL: community product photo storage
-- Public bucket so everyone can see community product images; only the
-- uploader can write to their own folder within it.
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read product images" ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');
CREATE POLICY "own product image insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images' AND owner = auth.uid());
CREATE POLICY "own product image delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images' AND owner = auth.uid());

-- ── Fitness: Friends & social (Phase FG-5) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  user_id       UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username      TEXT NOT NULL UNIQUE,
  display_name  TEXT,
  avatar        JSONB,
  created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles are publicly readable" ON profiles
  FOR SELECT USING (true);
CREATE POLICY "insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = user_id);

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

-- ── Fitness: quests, streaks, achievements (Phase FG-6) ─────────────────────
ALTER TABLE fitness_progress ADD COLUMN IF NOT EXISTS streak_freezes INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS streak_freeze_uses (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  week_start  DATE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, week_start)
);
ALTER TABLE streak_freeze_uses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own streak_freeze_uses" ON streak_freeze_uses
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS quest_claims (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  quest_code  TEXT NOT NULL,
  period_key  TEXT NOT NULL,
  claimed_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, quest_code, period_key)
);
ALTER TABLE quest_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own quest_claims" ON quest_claims
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS achievements (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code         TEXT NOT NULL,
  unlocked_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, code)
);
ALTER TABLE achievements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own achievements" ON achievements
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── Reselling: monthly profit goal calculator + duo goals ───────────────────
CREATE TABLE IF NOT EXISTS resell_goals (
  user_id              UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  target_profit        NUMERIC NOT NULL DEFAULT 0,
  avg_sale_price        NUMERIC,
  avg_profit_per_sale   NUMERIC,
  updated_at           TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE resell_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own resell_goals" ON resell_goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS duo_goals (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  requester_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  addressee_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  target_profit  NUMERIC NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now(),
  CHECK (requester_id <> addressee_id)
);
ALTER TABLE duo_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view own duo_goals" ON duo_goals
  FOR SELECT USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
CREATE POLICY "create duo_goals" ON duo_goals
  FOR INSERT WITH CHECK (auth.uid() = requester_id);
CREATE POLICY "respond duo_goals" ON duo_goals
  FOR UPDATE USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
CREATE POLICY "delete duo_goals" ON duo_goals
  FOR DELETE USING (auth.uid() = requester_id OR auth.uid() = addressee_id);
CREATE INDEX IF NOT EXISTS idx_duo_goals_requester ON duo_goals (requester_id, status);
CREATE INDEX IF NOT EXISTS idx_duo_goals_addressee ON duo_goals (addressee_id, status);

CREATE OR REPLACE FUNCTION resell_month_profit(target_user UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;

  IF auth.uid() <> target_user AND NOT EXISTS (
    SELECT 1 FROM friendships f
    WHERE f.status = 'accepted'
      AND ((f.requester_id = auth.uid() AND f.addressee_id = target_user)
        OR (f.addressee_id = auth.uid() AND f.requester_id = target_user))
  ) THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(sale_price - fees - shipping_cost - cost_snapshot), 0)
  INTO total
  FROM resell_sales
  WHERE user_id = target_user
    AND returned = false
    AND sold_date >= date_trunc('month', CURRENT_DATE)::date
    AND sold_date < (date_trunc('month', CURRENT_DATE) + INTERVAL '1 month')::date;

  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION resell_month_profit(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION resell_month_profit(UUID) TO authenticated;

-- ── Fitness: rest timer, exercise library, XP cooldown (Phase FG-7) ─────────
ALTER TABLE fitness_progress ADD COLUMN IF NOT EXISTS xp_cooldown_until TIMESTAMPTZ;

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

-- ── Profiles: usernames are permanent once set ──────────────────────────────
CREATE OR REPLACE FUNCTION prevent_username_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.username IS DISTINCT FROM OLD.username THEN
    RAISE EXCEPTION 'Username cannot be changed once set.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_username ON profiles;
CREATE TRIGGER lock_username
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_username_change();

-- ── Profiles: customizable avatar ────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar JSONB;

-- ── Admin roles, bans, curated Community catalog ────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ban_reason TEXT;

CREATE OR REPLACE FUNCTION is_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE((SELECT p.is_admin FROM profiles p WHERE p.user_id = uid), false);
$$;

CREATE OR REPLACE FUNCTION guard_profile_update()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.username IS DISTINCT FROM OLD.username THEN
    RAISE EXCEPTION 'Username cannot be changed once set.';
  END IF;

  IF (NEW.is_admin IS DISTINCT FROM OLD.is_admin
      OR NEW.banned IS DISTINCT FROM OLD.banned
      OR NEW.ban_reason IS DISTINCT FROM OLD.ban_reason)
     AND auth.uid() IS NOT NULL
     AND NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin can change admin/ban status.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lock_username ON profiles;
DROP TRIGGER IF EXISTS guard_profile_update_trigger ON profiles;
CREATE TRIGGER guard_profile_update_trigger
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION guard_profile_update();

DROP FUNCTION IF EXISTS prevent_username_change();

CREATE POLICY "admins update any profile" ON profiles
  FOR UPDATE USING (is_admin(auth.uid()));

DROP POLICY IF EXISTS "insert own products" ON product_catalog;
DROP POLICY IF EXISTS "update own products" ON product_catalog;
DROP POLICY IF EXISTS "delete own products" ON product_catalog;

CREATE POLICY "insert own products" ON product_catalog
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND (is_shared = false OR is_admin(auth.uid()))
  );
CREATE POLICY "update own products" ON product_catalog
  FOR UPDATE USING (auth.uid() = user_id OR is_admin(auth.uid()))
  WITH CHECK (
    (auth.uid() = user_id OR is_admin(auth.uid()))
    AND (is_shared = false OR is_admin(auth.uid()))
  );
CREATE POLICY "delete own products" ON product_catalog
  FOR DELETE USING (auth.uid() = user_id OR is_admin(auth.uid()));

-- One-off bootstrap (run by hand once): promote yourself to admin —
-- UPDATE profiles SET is_admin = true WHERE username = 'your_username_here';

-- ── Divisional ranks: rank_score + global position lookup ───────────────────
ALTER TABLE fitness_progress ADD COLUMN IF NOT EXISTS rank_score NUMERIC;

-- Note: "position" is a reserved SQL keyword and can't be used bare as a
-- RETURNS TABLE column name — hence rank_position/total_users instead.
CREATE OR REPLACE FUNCTION global_rank_position()
RETURNS TABLE(rank_position BIGINT, total_users BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  my_score NUMERIC;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  SELECT fp.rank_score INTO my_score FROM fitness_progress fp WHERE fp.user_id = auth.uid();
  IF my_score IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*)::BIGINT + 1 FROM fitness_progress fp2 WHERE fp2.rank_score > my_score) AS rank_position,
    (SELECT COUNT(*)::BIGINT FROM fitness_progress fp3 WHERE fp3.rank_score IS NOT NULL) AS total_users;
END;
$$;

REVOKE ALL ON FUNCTION global_rank_position() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION global_rank_position() TO authenticated;

-- ── DB-level ban enforcement — see migration-ban-enforcement.sql for the
-- full explanation. A banned user can still see/delete their own existing
-- rows but every INSERT/UPDATE below is rejected, even via a direct API call.
CREATE OR REPLACE FUNCTION is_banned(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE((SELECT banned FROM profiles WHERE user_id = uid), false);
$$;
REVOKE ALL ON FUNCTION is_banned(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_banned(UUID) TO authenticated;

DROP POLICY IF EXISTS "send friend request" ON friendships;
CREATE POLICY "send friend request" ON friendships
  FOR INSERT WITH CHECK (auth.uid() = requester_id AND NOT is_banned(auth.uid()));

DROP POLICY IF EXISTS "respond to friend request" ON friendships;
CREATE POLICY "respond to friend request" ON friendships
  FOR UPDATE USING (auth.uid() = addressee_id OR auth.uid() = requester_id)
  WITH CHECK ((auth.uid() = addressee_id OR auth.uid() = requester_id) AND NOT is_banned(auth.uid()));

DROP POLICY IF EXISTS "insert own products" ON product_catalog;
CREATE POLICY "insert own products" ON product_catalog
  FOR INSERT WITH CHECK (
    auth.uid() = user_id AND (is_shared = false OR is_admin(auth.uid())) AND NOT is_banned(auth.uid())
  );

DROP POLICY IF EXISTS "update own products" ON product_catalog;
CREATE POLICY "update own products" ON product_catalog
  FOR UPDATE USING (auth.uid() = user_id OR is_admin(auth.uid()))
  WITH CHECK (
    (auth.uid() = user_id OR is_admin(auth.uid()))
    AND (is_shared = false OR is_admin(auth.uid()))
    AND NOT is_banned(auth.uid())
  );

DROP POLICY IF EXISTS "create duo_goals" ON duo_goals;
CREATE POLICY "create duo_goals" ON duo_goals
  FOR INSERT WITH CHECK (auth.uid() = requester_id AND NOT is_banned(auth.uid()));

DROP POLICY IF EXISTS "respond duo_goals" ON duo_goals;
CREATE POLICY "respond duo_goals" ON duo_goals
  FOR UPDATE USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
  WITH CHECK ((auth.uid() = requester_id OR auth.uid() = addressee_id) AND NOT is_banned(auth.uid()));

DROP POLICY IF EXISTS "own workout_templates" ON workout_templates;
CREATE POLICY "select own workout_templates" ON workout_templates
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert own workout_templates" ON workout_templates
  FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT is_banned(auth.uid()));
CREATE POLICY "update own workout_templates" ON workout_templates
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND NOT is_banned(auth.uid()));
CREATE POLICY "delete own workout_templates" ON workout_templates
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own workouts" ON workouts;
CREATE POLICY "select own workouts" ON workouts
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert own workouts" ON workouts
  FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT is_banned(auth.uid()));
CREATE POLICY "update own workouts" ON workouts
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND NOT is_banned(auth.uid()));
CREATE POLICY "delete own workouts" ON workouts
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own resell_items" ON resell_items;
CREATE POLICY "select own resell_items" ON resell_items
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert own resell_items" ON resell_items
  FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT is_banned(auth.uid()));
CREATE POLICY "update own resell_items" ON resell_items
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND NOT is_banned(auth.uid()));
CREATE POLICY "delete own resell_items" ON resell_items
  FOR DELETE USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "own resell_sales" ON resell_sales;
CREATE POLICY "select own resell_sales" ON resell_sales
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert own resell_sales" ON resell_sales
  FOR INSERT WITH CHECK (auth.uid() = user_id AND NOT is_banned(auth.uid()));
CREATE POLICY "update own resell_sales" ON resell_sales
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND NOT is_banned(auth.uid()));
CREATE POLICY "delete own resell_sales" ON resell_sales
  FOR DELETE USING (auth.uid() = user_id);

-- ── Admin "erase progress" — explicit, opt-in per-area wipe, never touches
-- the profiles row (username/avatar/ban state survive). See
-- migration-admin-erase.sql for the full explanation.
CREATE OR REPLACE FUNCTION admin_erase_user_data(
  target UUID,
  wipe_fitness BOOLEAN DEFAULT false,
  wipe_reselling BOOLEAN DEFAULT false,
  wipe_food BOOLEAN DEFAULT false
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only an admin can erase user data.';
  END IF;

  IF wipe_fitness THEN
    DELETE FROM fitness_progress WHERE user_id = target;
    DELETE FROM workouts WHERE user_id = target;
    DELETE FROM weight_entries WHERE user_id = target;
    DELETE FROM personal_records WHERE user_id = target;
    DELETE FROM fitness_goals WHERE user_id = target;
    DELETE FROM achievements WHERE user_id = target;
    DELETE FROM quest_claims WHERE user_id = target;
    DELETE FROM streak_freeze_uses WHERE user_id = target;
    DELETE FROM workout_templates WHERE user_id = target;
    DELETE FROM splits WHERE user_id = target;
    DELETE FROM custom_exercises WHERE user_id = target;
  END IF;

  IF wipe_reselling THEN
    DELETE FROM resell_items WHERE user_id = target;
    DELETE FROM resell_sales WHERE user_id = target;
    DELETE FROM resell_expenses WHERE user_id = target;
    DELETE FROM resell_goals WHERE user_id = target;
    DELETE FROM duo_goals WHERE requester_id = target OR addressee_id = target;
    DELETE FROM product_catalog WHERE user_id = target;
  END IF;

  IF wipe_food THEN
    DELETE FROM foods WHERE user_id = target;
    DELETE FROM food_logs WHERE user_id = target;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION admin_erase_user_data(UUID, BOOLEAN, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_erase_user_data(UUID, BOOLEAN, BOOLEAN, BOOLEAN) TO authenticated;

-- ── Round 3: booster ownership, weight-planner stats, profile photos,
-- barcode memory, and friend messaging. See migration-round3.sql.
ALTER TABLE user_inventory DROP CONSTRAINT IF EXISTS user_inventory_item_type_check;
ALTER TABLE user_inventory ADD CONSTRAINT user_inventory_item_type_check
  CHECK (item_type IN ('theme', 'banner', 'booster'));
ALTER TABLE user_inventory ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS height_cm NUMERIC;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS age INTEGER;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS sex TEXT CHECK (sex IN ('male', 'female'));
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS activity_level NUMERIC;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS goal_weight NUMERIC;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS calorie_target NUMERIC;

ALTER TABLE foods ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS idx_foods_barcode ON foods (user_id, barcode);

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

ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- ── Round 4: push notifications, body measurements, progress photos,
-- rank-up tracking. See migration-round4.sql for the push dashboard setup.
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

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notif_prefs JSONB;

CREATE TABLE IF NOT EXISTS body_measurements (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  entry_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  values      JSONB NOT NULL DEFAULT '{}'::jsonb,
  note        TEXT DEFAULT '',
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE body_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own body_measurements" ON body_measurements
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_body_measurements_user_date ON body_measurements (user_id, entry_date DESC);

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

INSERT INTO storage.buckets (id, name, public)
VALUES ('progress-photos', 'progress-photos', false)
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "own progress photos read" ON storage.objects FOR SELECT
  USING (bucket_id = 'progress-photos' AND owner = auth.uid());
CREATE POLICY "own progress photos insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'progress-photos' AND owner = auth.uid());
CREATE POLICY "own progress photos delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'progress-photos' AND owner = auth.uid());

INSERT INTO storage.buckets (id, name, public)
VALUES ('progress-shares', 'progress-shares', true)
ON CONFLICT (id) DO NOTHING;
CREATE POLICY "public read progress shares" ON storage.objects FOR SELECT
  USING (bucket_id = 'progress-shares');
CREATE POLICY "own progress share insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'progress-shares' AND owner = auth.uid());
CREATE POLICY "own progress share delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'progress-shares' AND owner = auth.uid());

ALTER TABLE fitness_progress ADD COLUMN IF NOT EXISTS rank_label TEXT;

-- ── Round 6: recipes, water tracking, weight units, currency, reminders.
-- See migration-round6.sql for the reminders dashboard setup.
CREATE TABLE IF NOT EXISTS recipes (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  items      JSONB NOT NULL DEFAULT '[]'::jsonb,
  calories   NUMERIC NOT NULL DEFAULT 0,
  protein    NUMERIC NOT NULL DEFAULT 0,
  carbs      NUMERIC NOT NULL DEFAULT 0,
  fat        NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own recipes" ON recipes
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_recipes_user ON recipes (user_id, name);

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

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS water_goal_ml INTEGER;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS weight_unit TEXT NOT NULL DEFAULT 'kg' CHECK (weight_unit IN ('kg', 'lb'));
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT '£';
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS reminder_prefs JSONB;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS timezone TEXT;

-- ── Round 7: scheduled pushes (rest-timer background alerts).
-- See migration-round7.sql for the pg_cron dashboard setup.
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
CREATE INDEX IF NOT EXISTS idx_scheduled_pushes_due ON scheduled_pushes (fire_at) WHERE sent_at IS NULL;
