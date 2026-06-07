-- V180: Корзина склада (маркетплейс) — РП накликивает позиции из каталога/оборудования,
-- корзина персистентна (одна открытая на пользователя), хранит снимок остатка/цены на момент
-- добавления для перепроверки при отправке. На submit разбивается: наличие→резерв, дефицит→закупка.

CREATE TABLE IF NOT EXISTS warehouse_cart (
  id           SERIAL       PRIMARY KEY,
  user_id      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id INTEGER      REFERENCES warehouses(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (user_id)                                  -- одна открытая корзина на пользователя
);

CREATE TABLE IF NOT EXISTS warehouse_cart_items (
  id                 SERIAL       PRIMARY KEY,
  cart_id            INTEGER      NOT NULL REFERENCES warehouse_cart(id) ON DELETE CASCADE,
  item_type          VARCHAR(15)  NOT NULL CHECK (item_type IN ('consumable','equipment','new_position')),
  product_id         INTEGER      REFERENCES products(id) ON DELETE CASCADE,
  equipment_id       INTEGER      REFERENCES equipment(id) ON DELETE CASCADE,
  custom_name        VARCHAR(500),                  -- для новых позиций / несовпавших строк Excel
  need_qty           NUMERIC(14,3) NOT NULL DEFAULT 1 CHECK (need_qty > 0),
  work_id            INTEGER      REFERENCES works(id) ON DELETE SET NULL,   -- опц. привязка резерва
  price_segment      VARCHAR(10)  CHECK (price_segment IS NULL OR price_segment IN ('cheap','medium','premium')),
  manual_price       NUMERIC(14,2),                 -- цена для новой позиции / строки Excel
  supplier_name      VARCHAR(500),
  -- снимок каталога на момент добавления (для детекта изменений при отправке)
  snapshot_available NUMERIC(14,3),
  snapshot_price     NUMERIC(14,2),
  snapshot_supplier  VARCHAR(500),
  is_new_position    BOOLEAN      NOT NULL DEFAULT FALSE,
  source             VARCHAR(10)  NOT NULL DEFAULT 'catalog' CHECK (source IN ('catalog','manual','excel')),
  added_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  -- гарды соответствия типа и ссылок
  CONSTRAINT wci_consumable_needs_product  CHECK (item_type <> 'consumable'   OR product_id   IS NOT NULL),
  CONSTRAINT wci_equipment_needs_id        CHECK (item_type <> 'equipment'    OR equipment_id IS NOT NULL),
  CONSTRAINT wci_newpos_needs_name         CHECK (item_type <> 'new_position' OR custom_name  IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_wci_cart ON warehouse_cart_items(cart_id);
-- без дублей одного товара/единицы в одной корзине
CREATE UNIQUE INDEX IF NOT EXISTS idx_wci_uniq_product ON warehouse_cart_items(cart_id, product_id)   WHERE product_id   IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_wci_uniq_equip   ON warehouse_cart_items(cart_id, equipment_id) WHERE equipment_id IS NOT NULL;
