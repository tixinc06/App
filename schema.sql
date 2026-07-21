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
