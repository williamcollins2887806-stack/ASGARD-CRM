-- V160: Журнал движений количественного учёта (приход/расход/перемещение/списание/находка).
-- Поштучные движения оборудования — в существующей equipment_movements (НЕ дублируем).
-- ref_type/ref_id — связь с источником (закупка/сборка/ручная операция).
-- movement_type:
--   receipt  — приход (от поставщика / оприходование)
--   issue    — выдача (на работу / расход)
--   transfer — перемещение между ячейками/складами (from_* → to_*)
--   writeoff — списание (недостача/брак/израсходовано)
--   return   — возврат с объекта на склад
--   found    — оприходование излишка/находки (приехало больше чем отправляли)
--   adjust   — корректировка инвентаризации (+/-)

CREATE TABLE IF NOT EXISTS stock_movements (
  id                 BIGSERIAL    PRIMARY KEY,
  product_id         INTEGER      NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  from_warehouse_id  INTEGER      REFERENCES warehouses(id) ON DELETE SET NULL,
  from_location_id   INTEGER      REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  to_warehouse_id    INTEGER      REFERENCES warehouses(id) ON DELETE SET NULL,
  to_location_id     INTEGER      REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  qty                NUMERIC(14,3) NOT NULL CHECK (qty <> 0),
  unit               VARCHAR(50)  NOT NULL DEFAULT 'шт',
  movement_type      VARCHAR(20)  NOT NULL
                       CHECK (movement_type IN ('receipt','issue','transfer','writeoff','return','found','adjust')),
  ref_type           VARCHAR(20)  CHECK (ref_type IS NULL OR ref_type IN ('procurement','assembly','manual','inventory')),
  ref_id             INTEGER,
  reason             TEXT,
  created_by         INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stockmov_product ON stock_movements(product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stockmov_type    ON stock_movements(movement_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_stockmov_ref     ON stock_movements(ref_type, ref_id) WHERE ref_type IS NOT NULL;
