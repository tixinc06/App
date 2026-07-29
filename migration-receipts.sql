-- ============================================================================
-- MIGRATION: Reselling — receipts vault (folders + files)
-- run in Supabase SQL Editor.
-- ============================================================================

CREATE TABLE IF NOT EXISTS receipt_folders (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE receipt_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own receipt_folders" ON receipt_folders
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- folder_id/item_id both ON DELETE SET NULL — deleting a folder or an
-- inventory item must never destroy the document that proves what was spent.
CREATE TABLE IF NOT EXISTS receipts (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id      UUID REFERENCES receipt_folders(id) ON DELETE SET NULL,
  item_id        UUID REFERENCES resell_items(id) ON DELETE SET NULL,
  name           TEXT NOT NULL,
  merchant       TEXT DEFAULT '',
  amount         NUMERIC,
  receipt_date   DATE,
  storage_path   TEXT NOT NULL,
  mime_type      TEXT DEFAULT '',
  size_bytes     BIGINT,
  note           TEXT DEFAULT '',
  created_at     TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE receipts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own receipts" ON receipts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_receipts_user_folder ON receipts (user_id, folder_id, receipt_date DESC);

-- Private bucket — same pattern as resell-photos/progress-photos.
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "own receipt files read" ON storage.objects FOR SELECT
  USING (bucket_id = 'receipts' AND owner = auth.uid());
CREATE POLICY "own receipt files insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'receipts' AND owner = auth.uid());
CREATE POLICY "own receipt files delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'receipts' AND owner = auth.uid());
