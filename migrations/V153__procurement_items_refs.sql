-- V153: Связи позиций закупки со справочниками (мягкие, nullable).
-- Строковая колонка supplier ОСТАЁТСЯ для совместимости и free-text ввода.

ALTER TABLE procurement_items
  ADD COLUMN IF NOT EXISTS supplier_id         INTEGER REFERENCES suppliers(id)          ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_id          INTEGER REFERENCES products(id)           ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS product_category_id INTEGER REFERENCES product_categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proc_items_supplier_id ON procurement_items(supplier_id)         WHERE supplier_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proc_items_product_id  ON procurement_items(product_id)          WHERE product_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proc_items_prod_cat    ON procurement_items(product_category_id) WHERE product_category_id IS NOT NULL;
