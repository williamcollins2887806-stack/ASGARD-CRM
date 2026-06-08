-- Rollback V185
ALTER TABLE procurement_items
  DROP COLUMN IF EXISTS parent_item_id,
  DROP COLUMN IF EXISTS supplier_delivery_days,
  DROP COLUMN IF EXISTS invoice_import_id;
DROP INDEX IF EXISTS idx_pi_name_trgm;
DROP TABLE IF EXISTS procurement_invoice_imports CASCADE;
