-- V162: Расширение позиций сборки для WMS.
-- product_id        — связь позиции с каталогом (автокомплит, история).
-- source_location_id— из какой ячейки взяли при сборке.
-- expected_quantity — план (для демоба: сколько отправляли) → сверка с фактом возврата.
-- over_received     — TRUE если при разборе обнаружен излишек (приехало больше/неизвестное).

ALTER TABLE assembly_items
  ADD COLUMN IF NOT EXISTS product_id         INTEGER REFERENCES products(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_location_id INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS expected_quantity  NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS over_received      BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_assembly_items_product ON assembly_items(product_id) WHERE product_id IS NOT NULL;
