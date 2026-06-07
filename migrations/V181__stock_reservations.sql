-- V181: Резервы расходников на складе (трекинг). Агрегат лежит в stock.reserved_qty,
-- а здесь — «кто что под какую работу зарезервировал» (для снятия при демобилизации/отмене).
-- Создаётся при отправке корзины (наличие → резерв). Связь с заявкой закупки опциональна.

CREATE TABLE IF NOT EXISTS stock_reservations (
  id           SERIAL       PRIMARY KEY,
  product_id   INTEGER      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id INTEGER      NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  qty          NUMERIC(14,3) NOT NULL CHECK (qty > 0),
  work_id      INTEGER      REFERENCES works(id) ON DELETE SET NULL,        -- опционально
  reserved_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  procurement_id INTEGER    REFERENCES procurement_requests(id) ON DELETE SET NULL,  -- если разбивка дала заявку
  status       VARCHAR(10)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','released','fulfilled')),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  released_at  TIMESTAMPTZ,
  notes        VARCHAR(500)
);

CREATE INDEX IF NOT EXISTS idx_sr_active ON stock_reservations(product_id, warehouse_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS idx_sr_work   ON stock_reservations(work_id) WHERE work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sr_by     ON stock_reservations(reserved_by);
