-- ============================================================================
-- MIGRATION: Reselling polish round 2 — run this in Supabase SQL Editor
-- Adds: a "Link" field + quantity on inventory items, quantity on sales,
-- and a PUBLIC storage bucket for community product photos.
-- ============================================================================

-- Sourcing link carried from a product onto the inventory item.
ALTER TABLE resell_items ADD COLUMN IF NOT EXISTS product_url TEXT;

-- How many units you hold / sold (enables partial sells).
ALTER TABLE resell_items ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;
ALTER TABLE resell_sales ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1;

-- ── Public bucket for community product photos ──────────────────────────────
-- Public READ (so everyone sees community product images), but only the
-- uploader can write to their own folder within it.
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "public read product images" ON storage.objects FOR SELECT
  USING (bucket_id = 'product-images');
CREATE POLICY "own product image insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'product-images' AND owner = auth.uid());
CREATE POLICY "own product image delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'product-images' AND owner = auth.uid());
