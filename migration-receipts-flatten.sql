-- ============================================================================
-- MIGRATION: Receipts — drop the folder layer
-- Receipts is now one flat section (no folders). Run in Supabase SQL Editor.
-- Safe to run whether or not you ever created any folders.
-- ============================================================================

DROP INDEX IF EXISTS idx_receipts_user_folder;
ALTER TABLE receipts DROP COLUMN IF EXISTS folder_id;
DROP TABLE IF EXISTS receipt_folders;

CREATE INDEX IF NOT EXISTS idx_receipts_user_date ON receipts (user_id, receipt_date DESC);
