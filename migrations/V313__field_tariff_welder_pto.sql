-- ═══════════════════════════════════════════════════════════════════════════
-- V313: Сетка ставок Сварщик (14–40б) и ПТО (14–30б) по site-категориям
--
-- Категории: mlsp, ground, ground_hard, warehouse.
-- rate_per_shift = points * 500 (point_value).
-- Идемпотентно: WHERE NOT EXISTS по (category, position_name, points).
-- Остальные позиции сетки не трогаем.
-- ═══════════════════════════════════════════════════════════════════════════

-- Сварщик 14…40б
INSERT INTO field_tariff_grid
  (category, position_name, points, rate_per_shift, point_value, sort_order, is_active,
   is_combinable, requires_approval, notes, created_at, updated_at)
SELECT
  c.category,
  'Сварщик (' || p.points::text || 'б)',
  p.points,
  p.points * 500,
  500,
  8000 + p.points,
  TRUE,
  FALSE,
  FALSE,
  'Сетка сварщика: ' || p.points::text || 'б × 500 ₽',
  NOW(),
  NOW()
FROM (VALUES ('mlsp'), ('ground'), ('ground_hard'), ('warehouse')) AS c(category)
CROSS JOIN generate_series(14, 40) AS p(points)
WHERE NOT EXISTS (
  SELECT 1 FROM field_tariff_grid dup
  WHERE dup.category = c.category
    AND dup.position_name = 'Сварщик (' || p.points::text || 'б)'
    AND dup.points = p.points
);

-- ПТО 14…30б
INSERT INTO field_tariff_grid
  (category, position_name, points, rate_per_shift, point_value, sort_order, is_active,
   is_combinable, requires_approval, notes, created_at, updated_at)
SELECT
  c.category,
  'ПТО (' || p.points::text || 'б)',
  p.points,
  p.points * 500,
  500,
  8500 + p.points,
  TRUE,
  FALSE,
  FALSE,
  'Сетка ПТО: ' || p.points::text || 'б × 500 ₽',
  NOW(),
  NOW()
FROM (VALUES ('mlsp'), ('ground'), ('ground_hard'), ('warehouse')) AS c(category)
CROSS JOIN generate_series(14, 30) AS p(points)
WHERE NOT EXISTS (
  SELECT 1 FROM field_tariff_grid dup
  WHERE dup.category = c.category
    AND dup.position_name = 'ПТО (' || p.points::text || 'б)'
    AND dup.points = p.points
);
