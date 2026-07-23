-- ============================================================================
-- MIGRATION: DB-level ban enforcement — a banned user can no longer write to
-- the app's key tables, even via a direct API call (bypassing the client
-- gate entirely). Run in Supabase SQL Editor.
-- ============================================================================
-- Context: the client-side "Account suspended" gate in js/app.js is a UI
-- convenience only — it can always be bypassed with dev tools against a
-- static PWA that talks straight to Supabase. This migration makes bans bite
-- at the database: a banned user can still SEE and DELETE their own existing
-- rows (so, e.g., they can still clean up after themselves), but every
-- INSERT/UPDATE on the tables below is rejected outright.

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

-- ── friendships (already split into per-command policies) ───────────────────
DROP POLICY IF EXISTS "send friend request" ON friendships;
CREATE POLICY "send friend request" ON friendships
  FOR INSERT WITH CHECK (auth.uid() = requester_id AND NOT is_banned(auth.uid()));

DROP POLICY IF EXISTS "respond to friend request" ON friendships;
CREATE POLICY "respond to friend request" ON friendships
  FOR UPDATE USING (auth.uid() = addressee_id OR auth.uid() = requester_id)
  WITH CHECK ((auth.uid() = addressee_id OR auth.uid() = requester_id) AND NOT is_banned(auth.uid()));

-- ── product_catalog (already split into per-command policies) ───────────────
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

-- ── duo_goals (already split into per-command policies) ─────────────────────
DROP POLICY IF EXISTS "create duo_goals" ON duo_goals;
CREATE POLICY "create duo_goals" ON duo_goals
  FOR INSERT WITH CHECK (auth.uid() = requester_id AND NOT is_banned(auth.uid()));

DROP POLICY IF EXISTS "respond duo_goals" ON duo_goals;
CREATE POLICY "respond duo_goals" ON duo_goals
  FOR UPDATE USING (auth.uid() = requester_id OR auth.uid() = addressee_id)
  WITH CHECK ((auth.uid() = requester_id OR auth.uid() = addressee_id) AND NOT is_banned(auth.uid()));

-- ── workout_templates, workouts, resell_items, resell_sales ─────────────────
-- These currently use a single "FOR ALL" policy (one USING/WITH CHECK pair
-- covering SELECT/INSERT/UPDATE/DELETE). Splitting into 4 per-command
-- policies lets INSERT/UPDATE add the ban check while SELECT/DELETE stay
-- untouched (a banned user keeps read/delete access to their own data).

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
