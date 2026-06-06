-- Rollback V157
DROP INDEX IF EXISTS idx_products_ean;
DROP INDEX IF EXISTS idx_products_draft;
DROP INDEX IF EXISTS idx_products_consumable;
ALTER TABLE products
  DROP COLUMN IF EXISTS ean,
  DROP COLUMN IF EXISTS is_consumable,
  DROP COLUMN IF EXISTS is_draft,
  DROP COLUMN IF EXISTS created_from,
  DROP COLUMN IF EXISTS min_stock_level,
  DROP COLUMN IF EXISTS photo_url,
  DROP COLUMN IF EXISTS default_supplier_id,
  DROP COLUMN IF EXISTS deleted_at;
