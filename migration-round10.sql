-- ============================================================================
-- MIGRATION: Round 10 — food favourites + saved workout duration.
-- Run in Supabase SQL Editor.
-- ============================================================================

-- ── Food favourites (Part A) — a one-tap star on a food, surfaced as a
-- quick-log strip at the top of the Food view.
ALTER TABLE foods ADD COLUMN IF NOT EXISTS favourite BOOLEAN NOT NULL DEFAULT false;

-- ── Saved workout duration (Part E) — the workout builder already computes
-- a live elapsed-time readout; this persists it instead of discarding it.
ALTER TABLE workouts ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;
