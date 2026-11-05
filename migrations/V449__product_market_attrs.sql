-- V449: атрибуты маркетплейса номенклатуры (pack, base unit, keywords)
-- Откат: V449__product_market_attrs_down.sql

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS pack_qty NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS base_unit TEXT,
  ADD COLUMN IF NOT EXISTS unit_price_base NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS search_keywords TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS attrs JSONB DEFAULT '{}'::jsonb;

COMMENT ON COLUMN products.pack_qty IS 'Штук (или база) в упаковке продажи';
COMMENT ON COLUMN products.base_unit IS 'Канон ед.: шт|кг|м|л|пар|компл';
COMMENT ON COLUMN products.unit_price_base IS 'Цена за base_unit (кэш с последнего счёта)';
COMMENT ON COLUMN products.search_keywords IS '10–20 ключей для поиска маркетплейса';
COMMENT ON COLUMN products.attrs IS 'Размеры/ГОСТ/вес упаковки и пр.';

CREATE INDEX IF NOT EXISTS idx_products_search_keywords_gin
  ON products USING GIN (search_keywords);

CREATE INDEX IF NOT EXISTS idx_products_attrs_gin
  ON products USING GIN (attrs);
