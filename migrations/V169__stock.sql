-- V159: Количественный остаток (наличие) — для расходников и количественного учёта.
-- Поштучное дорогое/уникальное оборудование остаётся в equipment (по инв.номеру + QR).
-- Один и тот же товар может лежать в нескольких ячейках/складах → одна строка на (product,wh,location).
-- reserved_qty — зарезервировано под работы (мобилизация), доступно = quantity - reserved_qty.

CREATE TABLE IF NOT EXISTS stock (
  id           SERIAL        PRIMARY KEY,
  product_id   INTEGER       NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id INTEGER       NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  location_id  INTEGER       REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  quantity     NUMERIC(14,3) NOT NULL DEFAULT 0,
  reserved_qty NUMERIC(14,3) NOT NULL DEFAULT 0,
  unit         VARCHAR(50)   NOT NULL DEFAULT 'шт',
  updated_at   TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stock_slot UNIQUE (product_id, warehouse_id, location_id),
  CONSTRAINT chk_stock_qty CHECK (quantity >= 0 AND reserved_qty >= 0)
);

CREATE INDEX IF NOT EXISTS idx_stock_product   ON stock(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_warehouse ON stock(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stock_location  ON stock(location_id) WHERE location_id IS NOT NULL;
-- Поиск позиций с положительным остатком (витрина наличия)
CREATE INDEX IF NOT EXISTS idx_stock_positive  ON stock(product_id, warehouse_id) WHERE quantity > 0;
