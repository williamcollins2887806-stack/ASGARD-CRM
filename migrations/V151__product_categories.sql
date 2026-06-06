-- V151: Категории товаров закупки (2 уровня: корень + подкатегория)
-- Иерархия enforced в app layer (max depth = 2).

CREATE TABLE IF NOT EXISTS product_categories (
  id          SERIAL       PRIMARY KEY,
  name        VARCHAR(255) NOT NULL,
  parent_id   INTEGER      REFERENCES product_categories(id) ON DELETE SET NULL,
  sort_order  SMALLINT     NOT NULL DEFAULT 0,
  is_active   BOOLEAN      NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_prod_cat_name_parent UNIQUE (name, parent_id)
);

CREATE INDEX IF NOT EXISTS idx_product_categories_parent ON product_categories(parent_id);

-- Seed корневых категорий (idempotent через ON CONFLICT)
INSERT INTO product_categories (name, sort_order) VALUES
  ('Строительные материалы', 10),
  ('Метизы и крепёж',        20),
  ('Электрика',              30),
  ('Сантехника',             40),
  ('Химия и расходники',     50),
  ('Аренда техники',         60),
  ('Инструмент',             70),
  ('Услуги',                 80),
  ('Прочее',                 90)
ON CONFLICT (name, parent_id) DO NOTHING;
