-- V164: Добор справочников для WMS.
-- product_categories: V151 засеял 9 корней. Добавляем недостающие для нашего профиля.
-- Гарантируем наличие главного склада (нужен для приёмки/оприходования по умолчанию).

INSERT INTO product_categories (name, sort_order) VALUES
  ('СИЗ (средства защиты)', 45),
  ('Насосы и оборудование', 55),
  ('Шланги и рукава',       65)
ON CONFLICT (name, parent_id) DO NOTHING;

-- Если нет ни одного главного склада — назначить первый активный главным,
-- а если складов нет вовсе — создать «Основной склад».
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM warehouses WHERE is_main = true AND is_active = true) THEN
    IF EXISTS (SELECT 1 FROM warehouses WHERE is_active = true) THEN
      UPDATE warehouses SET is_main = true
      WHERE id = (SELECT id FROM warehouses WHERE is_active = true ORDER BY id LIMIT 1);
    ELSE
      INSERT INTO warehouses (name, is_active, is_main) VALUES ('Основной склад', true, true);
    END IF;
  END IF;
END $$;
