-- ============================================================================
-- MIGRATION: Admin "erase progress" — an explicit, opt-in, per-area wipe of a
-- user's data. Separate from ban/unban (which never touches data) and never
-- automatic. Run in Supabase SQL Editor.
-- ============================================================================
-- Every data table is `auth.uid() = user_id` RLS, so an admin cannot delete
-- another user's rows directly. Rather than widening RLS across every table,
-- this SECURITY DEFINER function checks is_admin(auth.uid()) itself and then
-- deletes only the requested area(s). The `profiles` row (username, avatar,
-- ban state) is NEVER touched — an erase wipes activity/progress, not identity.

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
