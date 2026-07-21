-- ============================================================================
-- MIGRATION: Reselling — monthly profit goal calculator + duo goals
-- run in Supabase SQL Editor.
-- ============================================================================

-- One recurring monthly goal per user. avg_sale_price / avg_profit_per_sale
-- are OVERRIDES — NULL means "derive from this user's real sales history"
-- (js/resellgoals.js). Fully editable any time.
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

-- A shared monthly profit target between two accepted friends. Both
-- partners' current-month profit is summed toward the one target.
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

-- Returns target_user's current-calendar-month realized profit, but ONLY if
-- the caller IS target_user or an ACCEPTED friend of theirs — otherwise NULL.
-- SECURITY DEFINER so it can read resell_sales across the RLS boundary for
-- that one check; everything else about resell_sales stays fully private.
-- This is the only way a duo goal's combined bar can show a partner's month
-- profit without ever exposing their individual sales rows.
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
