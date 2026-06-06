-- V152: Каталог номенклатуры (мягкая привязка позиций закупки к товару)
-- Якорь для агрегации истории цен. product_id на позициях — nullable.

CREATE TABLE IF NOT EXISTS products (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(500) NOT NULL,
  article     VARCHAR(100),
  unit        VARCHAR(50)  NOT NULL DEFAULT 'шт',
  category_id INTEGER      REFERENCES product_categories(id) ON DELETE SET NULL,
  notes       TEXT,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_category  ON products(category_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_products_article   ON products(article)     WHERE article IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_products_name_trgm ON products USING gin(name gin_trgm_ops);
