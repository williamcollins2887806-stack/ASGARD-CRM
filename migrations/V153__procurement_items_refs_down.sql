-- Rollback V153
DROP INDEX IF EXISTS idx_proc_items_supplier_id;
DROP INDEX IF EXISTS idx_proc_items_product_id;
DROP INDEX IF EXISTS idx_proc_items_prod_cat;
ALTER TABLE procurement_items
  DROP COLUMN IF EXISTS supplier_id,
  DROP COLUMN IF EXISTS product_id,
  DROP COLUMN IF EXISTS product_category_id;
