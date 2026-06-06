-- V154: База цен (история цен) для подсказок и анализа поставщиков.
-- Наполняется: при доставке позиции (source=procurement), ручным вводом (manual),
-- AI-поиском (ai_search), из КП (quote), мониторинга рынка (market_monitoring).
-- Имена товара/поставщика денормализованы (snapshot на момент записи).

CREATE TABLE IF NOT EXISTS price_records (
  id                  BIGSERIAL    PRIMARY KEY,

  -- ЧТО
  product_id          INTEGER      REFERENCES products(id)           ON DELETE SET NULL,
  product_category_id INTEGER      REFERENCES product_categories(id) ON DELETE SET NULL,
  item_name           VARCHAR(500) NOT NULL,
  article             VARCHAR(100),
  unit                VARCHAR(50)  NOT NULL DEFAULT 'шт',

  -- КТО ПРОДАВАЛ
  supplier_id         INTEGER      REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name       VARCHAR(500),

  -- ЦЕНА
  unit_price          NUMERIC(15,2) NOT NULL CHECK (unit_price > 0),
  currency            CHAR(3)      NOT NULL DEFAULT 'RUB',
  region              VARCHAR(100),

  -- ИСТОЧНИК
  source              VARCHAR(20)  NOT NULL DEFAULT 'procurement'
                        CHECK (source IN ('procurement','manual','ai_search','quote','market_monitoring')),
  source_url          VARCHAR(1000),
  procurement_item_id INTEGER      REFERENCES procurement_items(id) ON DELETE SET NULL,

  valid_until         TIMESTAMPTZ,
  notes               TEXT,

  recorded_by         INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  recorded_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Последняя цена по товару
CREATE INDEX IF NOT EXISTS idx_pr_product_date  ON price_records(product_id, recorded_at DESC) WHERE product_id IS NOT NULL;
-- Последняя цена по названию (когда product_id пуст)
CREATE INDEX IF NOT EXISTS idx_pr_name_date     ON price_records(item_name, recorded_at DESC);
-- Средняя/медиана по категории
CREATE INDEX IF NOT EXISTS idx_pr_category_date ON price_records(product_category_id, recorded_at DESC) WHERE product_category_id IS NOT NULL;
-- Лучшая цена поставщика по товару
CREATE INDEX IF NOT EXISTS idx_pr_supplier_product_date ON price_records(supplier_id, product_id, recorded_at DESC) WHERE supplier_id IS NOT NULL AND product_id IS NOT NULL;
-- На будущее: KPI закупщика
CREATE INDEX IF NOT EXISTS idx_pr_recorded_by_date ON price_records(recorded_by, source, recorded_at DESC) WHERE recorded_by IS NOT NULL;
