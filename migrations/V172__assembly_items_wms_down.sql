-- Rollback V162
DROP INDEX IF EXISTS idx_assembly_items_product;
ALTER TABLE assembly_items
  DROP COLUMN IF EXISTS product_id,
  DROP COLUMN IF EXISTS source_location_id,
  DROP COLUMN IF EXISTS expected_quantity,
  DROP COLUMN IF EXISTS over_received;
