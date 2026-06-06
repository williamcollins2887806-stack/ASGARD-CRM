-- V157: Расширение каталога products полями склада (WMS).
-- Каталог = справочник «всё что когда-либо покупали» (живёт даже при 0 остатке).
-- Наличие (сколько и где) — отдельно в stock (V159). Здесь только атрибуты позиции.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS ean                 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS is_consumable       BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_draft            BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_from        VARCHAR(30) NOT NULL DEFAULT 'manual'
                            CHECK (created_from IN ('manual','import','on_site_purchase','from_warehouse','own','procurement','found')),
  ADD COLUMN IF NOT EXISTS min_stock_level     NUMERIC(14,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS photo_url           TEXT,
  ADD COLUMN IF NOT EXISTS default_supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS deleted_at          TIMESTAMPTZ;

-- Поиск по штрихкоду поставщика (привязка при приёмке)
CREATE INDEX IF NOT EXISTS idx_products_ean        ON products(ean) WHERE ean IS NOT NULL;
-- Модерация черновиков, созданных «за 10 сек» рабочими
CREATE INDEX IF NOT EXISTS idx_products_draft       ON products(is_draft) WHERE is_draft = true AND deleted_at IS NULL;
-- Расходники для контроля min-stock
CREATE INDEX IF NOT EXISTS idx_products_consumable  ON products(is_consumable) WHERE is_consumable = true AND deleted_at IS NULL;
