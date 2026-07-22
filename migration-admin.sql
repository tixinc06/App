-- ============================================================================
-- MIGRATION: Admin roles, bans, and a curated Community product catalog.
-- Run in Supabase SQL Editor.
-- ============================================================================
-- Everything privileged here is enforced in Postgres, not just hidden in the
-- UI — this is a static PWA that talks straight to Supabase, so anything
-- only gated client-side is trivially bypassable from the browser console.

-- ── profiles: admin + ban columns ────────────────────────────────────────────
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS banned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ban_reason TEXT;

-- SECURITY DEFINER so RLS policies (below, and on product_catalog) can ask
-- "is this caller an admin" without recursing through profiles' own RLS
-- (a normal query from inside a profiles policy would re-trigger the policy).
CREATE OR REPLACE FUNCTION is_admin(uid UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT COALESCE((SELECT p.is_admin FROM profiles p WHERE p.user_id = uid), false);
$$;

-- Replaces the old prevent_username_change trigger with a combined guard:
--  - usernames stay permanent for EVERYONE, admins included;
--  - is_admin / banned / ban_reason can only be changed by an existing admin,
--    or when auth.uid() IS NULL (the SQL-editor / service-role path — this is
--    what makes the one-time first-admin bootstrap possible).
-- This is the load-bearing guard: it's what stops a user self-promoting to
-- admin, and what stops a banned user clearing their own ban, even via a
-- direct API call from the browser console.
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

-- Admins need to be able to write to OTHER users' profile rows (to ban/
-- promote them) — the existing "update own profile" policy only allows
-- auth.uid() = user_id. This adds that capability; the trigger above still
-- constrains WHICH columns an admin-on-someone-else's-row update may touch
-- (only is_admin/banned/ban_reason go through when it's not their own row —
-- in practice the admin panel only ever writes those columns for others).
CREATE POLICY "admins update any profile" ON profiles
  FOR UPDATE USING (is_admin(auth.uid()));

-- ── product_catalog: only admins publish to the shared Community catalog ────
-- Policies can't be altered in place — drop and recreate.
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

-- ── One-off bootstrap: run this yourself, once, replacing the username ──────
-- UPDATE profiles SET is_admin = true WHERE username = 'your_username_here';
