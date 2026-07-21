-- ============================================================================
-- MIGRATION: Customizable avatar on profiles — run in Supabase SQL Editor.
-- ============================================================================
-- Stores the avatar builder config: {bg, skin, hair, hairColor, face, outfit}.
-- profiles is already publicly readable (FG-5) and the "update own profile"
-- policy has no column restriction, so this rides on existing RLS — friends
-- see your avatar for free, and the username-lock trigger only guards the
-- username column (avatar-only updates leave username unchanged, so they
-- pass the trigger untouched).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar JSONB;
