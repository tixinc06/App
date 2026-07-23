-- ============================================================================
-- MIGRATION: Divisional ranks — rank_score + global position lookup.
-- Run in Supabase SQL Editor.
-- ============================================================================
-- rank_score is a continuous 0-30 value (the weighted average of global
-- division indices across a user's ranked lifts — see js/ranks.js), written
-- every time ranks are computed. It's the input to global_rank_position(),
-- which is the ONLY way Godly can be granted (top 500 + maxed Grand
-- Champion 3) without exposing any other user's data — RLS on
-- fitness_progress stays exactly as it is (own row only); this function
-- returns nothing but the caller's own aggregate position.

ALTER TABLE fitness_progress ADD COLUMN IF NOT EXISTS rank_score NUMERIC;

-- Note: "position" is a reserved SQL keyword (the POSITION(... IN ...)
-- function) and can't be used bare as a RETURNS TABLE column name — hence
-- rank_position/total_users instead.
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
