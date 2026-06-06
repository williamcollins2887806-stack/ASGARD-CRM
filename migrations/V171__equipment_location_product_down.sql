-- Rollback V161
DROP INDEX IF EXISTS idx_equipment_location;
DROP INDEX IF EXISTS idx_equipment_product;
ALTER TABLE equipment
  DROP COLUMN IF EXISTS location_id,
  DROP COLUMN IF EXISTS product_id;
