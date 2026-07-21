-- ============================================================================
-- MIGRATION: Lock usernames permanently once set — run in Supabase SQL Editor.
-- ============================================================================
-- A username is chosen once (at signup, or the first-login gate for older
-- accounts) and can never change after that — enforced here at the database
-- level so it holds even if something bypasses the app UI (a direct API call,
-- a future bug, etc). display_name is unaffected and stays freely editable.

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
