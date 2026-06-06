-- V161: Привязка поштучного оборудования к ячейке хранения и каталожной позиции.
-- location_id — где физически лежит единица (для раскладки/поиска «куда класть»).
-- product_id — мягкая связь единицы с каталогом (одна модель = много единиц).

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_id  INTEGER REFERENCES products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_equipment_location ON equipment(location_id) WHERE location_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_equipment_product  ON equipment(product_id)  WHERE product_id IS NOT NULL;
