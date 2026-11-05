-- down V449
DROP INDEX IF EXISTS idx_products_attrs_gin;
DROP INDEX IF EXISTS idx_products_search_keywords_gin;

ALTER TABLE products
  DROP COLUMN IF EXISTS attrs,
  DROP COLUMN IF EXISTS search_keywords,
  DROP COLUMN IF EXISTS unit_price_base,
  DROP COLUMN IF EXISTS base_unit,
  DROP COLUMN IF EXISTS pack_qty;
