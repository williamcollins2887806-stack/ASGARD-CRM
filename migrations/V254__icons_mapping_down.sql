-- V254 DOWN: откат маппинга иконок

DROP TRIGGER IF EXISTS trg_products_auto_icon  ON products;
DROP TRIGGER IF EXISTS trg_equipment_auto_icon ON equipment;
DROP FUNCTION IF EXISTS fn_auto_icon_slug();

DROP INDEX IF EXISTS idx_products_icon_slug;
DROP INDEX IF EXISTS idx_equipment_icon_slug;
DROP INDEX IF EXISTS idx_icon_catalog_name;

DROP TABLE IF EXISTS icon_catalog;

ALTER TABLE products  DROP COLUMN IF EXISTS icon_slug;
ALTER TABLE equipment DROP COLUMN IF EXISTS icon_slug;
