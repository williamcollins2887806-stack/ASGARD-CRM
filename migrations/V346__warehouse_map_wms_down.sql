-- V346 down
BEGIN;

DROP TABLE IF EXISTS warehouse_inventory_lines CASCADE;
DROP TABLE IF EXISTS warehouse_inventory_sessions CASCADE;
DROP TABLE IF EXISTS warehouse_op_session_items CASCADE;
DROP TABLE IF EXISTS warehouse_op_sessions CASCADE;

ALTER TABLE warehouse_locations
  DROP COLUMN IF EXISTS map_object_id,
  DROP COLUMN IF EXISTS shelf_idx,
  DROP COLUMN IF EXISTS place_idx,
  DROP COLUMN IF EXISTS place_code;

ALTER TABLE assembly_items
  DROP COLUMN IF EXISTS cart_item_snapshot,
  DROP COLUMN IF EXISTS line_status,
  DROP COLUMN IF EXISTS unpick_to_location_id;

ALTER TABLE assembly_orders
  DROP COLUMN IF EXISTS source_cart_id,
  DROP COLUMN IF EXISTS auto_from_cart;

DROP TABLE IF EXISTS warehouse_map_objects CASCADE;
DROP TABLE IF EXISTS warehouse_map_floors CASCADE;

DROP INDEX IF EXISTS idx_products_barcode;

COMMIT;
