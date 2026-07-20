-- ============================================================================
-- MIGRATION: Reselling — Returns support — run this in Supabase SQL Editor
-- Adds a "returned" flag to sales so a returned sale can be excluded from
-- profit/P&L while its history is kept for return-rate analytics.
-- ============================================================================

ALTER TABLE resell_sales ADD COLUMN IF NOT EXISTS returned BOOLEAN NOT NULL DEFAULT false;
