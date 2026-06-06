-- Rollback V175 (вернуть исходный набор источников V053)
ALTER TABLE assembly_items DROP CONSTRAINT IF EXISTS assembly_items_source_check;
ALTER TABLE assembly_items ADD CONSTRAINT assembly_items_source_check
  CHECK (source IN ('reservation','procurement_warehouse','procurement_object','manual','on_site_purchase'));
