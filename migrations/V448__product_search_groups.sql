-- V448: группы поиска номенклатуры + категории «Жильё» / «Питание».
-- Цель: в каталоге не мешать проживание, оборудование и расходники.
-- search_group — стабильный код для фильтров UI (chips).

ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS search_group VARCHAR(32);

COMMENT ON COLUMN product_categories.search_group IS
  'Группа поиска: housing|equipment|consumable|materials|tools|ppe|services|food|other';

-- Новые корневые категории
INSERT INTO product_categories (name, sort_order, search_group) VALUES
  ('Жильё и проживание', 5,  'housing'),
  ('Питание',            8,  'food')
ON CONFLICT (name, parent_id) DO UPDATE
  SET search_group = EXCLUDED.search_group,
      sort_order   = EXCLUDED.sort_order;

-- Проставить search_group существующим корням
UPDATE product_categories SET search_group = v.g
FROM (VALUES
  ('Жильё и проживание',     'housing'),
  ('Питание',                'food'),
  ('Оборудование',           'equipment'),
  ('Техника',                'equipment'),
  ('Измерительные приборы',  'equipment'),
  ('Насосы и оборудование',  'equipment'),
  ('Аренда техники',         'equipment'),
  ('Химия и расходники',     'consumable'),
  ('Метизы и крепёж',        'consumable'),
  ('Шланги и рукава',        'consumable'),
  ('Строительные материалы', 'materials'),
  ('Электрика',              'materials'),
  ('Сантехника',             'materials'),
  ('Инструмент',             'tools'),
  ('СИЗ (средства защиты)',  'ppe'),
  ('Услуги',                 'services'),
  ('Прочее',                 'other')
) AS v(n, g)
WHERE product_categories.name = v.n
  AND product_categories.parent_id IS NULL;

-- Подкатегории наследуют группу родителя, если пусто
UPDATE product_categories c
SET search_group = p.search_group
FROM product_categories p
WHERE c.parent_id = p.id
  AND c.search_group IS NULL
  AND p.search_group IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_product_categories_search_group
  ON product_categories(search_group)
  WHERE is_active = true AND search_group IS NOT NULL;
