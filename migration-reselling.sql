-- ============================================================================
-- MIGRATION: Reselling tab rebuild — run this in Supabase SQL Editor
-- (adds the 2 new tables the Overview/Products segments need; safe to run
-- once even though schema.sql now also contains this, since IF NOT EXISTS /
-- ON CONFLICT guards are used where relevant)
-- ============================================================================

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
