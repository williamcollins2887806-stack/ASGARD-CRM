-- ═══════════════════════════════════════════════════════════════════════════
-- V318: Базовые ставки по ролям на работу + дробные доплаты в бригаде
--
-- 1) field_project_settings.role_base_rates JSONB — пресеты ролей после создания
-- 2) employee_assignments.manual_extra_points — ручная доплата (в т.ч. 3.5б)
-- 3) employee_assignments.combo_tariff_ids — несколько галочек совмещений
-- 4) tariff_points → NUMERIC (итог может быть дробным)
-- 5) Раздельные preset-совмещения: Водитель / Электрик / Сварщик / Высокая нагрузка
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE field_project_settings
  ADD COLUMN IF NOT EXISTS role_base_rates JSONB DEFAULT NULL;

ALTER TABLE employee_assignments
  ADD COLUMN IF NOT EXISTS manual_extra_points NUMERIC(6,2) NOT NULL DEFAULT 0;

ALTER TABLE employee_assignments
  ADD COLUMN IF NOT EXISTS combo_tariff_ids INTEGER[] NOT NULL DEFAULT '{}';

-- Итог баллов может быть дробным (база целая + 3.5 доплата)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employee_assignments'
      AND column_name = 'tariff_points'
      AND data_type = 'integer'
  ) THEN
    ALTER TABLE employee_assignments
      ALTER COLUMN tariff_points TYPE NUMERIC(8,2)
      USING tariff_points::numeric;
  END IF;
END $$;

-- Backfill combo_tariff_ids из combination_tariff_id
UPDATE employee_assignments
SET combo_tariff_ids = ARRAY[combination_tariff_id]
WHERE combination_tariff_id IS NOT NULL
  AND (combo_tariff_ids IS NULL OR combo_tariff_ids = '{}');

-- Раздельные совмещения (галочки). Старые «Совмещение: …» оставляем активными
-- для уже назначенных людей; новые назначения используют отдельные строки.
INSERT INTO field_tariff_grid
  (category, position_name, points, rate_per_shift, point_value, sort_order,
   is_active, is_combinable, requires_approval, notes, created_at, updated_at)
SELECT
  c.category,
  p.position_name,
  p.points,
  p.points * 500,
  500,
  p.sort_order,
  TRUE,
  TRUE,
  TRUE,
  p.notes,
  NOW(),
  NOW()
FROM (VALUES
  ('mlsp'), ('ground'), ('ground_hard'), ('warehouse')
) AS c(category)
CROSS JOIN (VALUES
  ('Водитель (+1б)',           1, 20, 'Совмещение: водитель'),
  ('Электрик (+1б)',           1, 21, 'Совмещение: электрик'),
  ('Сварщик совмещение (+1б)', 1, 22, 'Совмещение: сварщик'),
  ('Высокая нагрузка (+2б)',   2, 23, 'Совмещение: повышенная нагрузка')
) AS p(position_name, points, sort_order, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM field_tariff_grid dup
  WHERE dup.category = c.category
    AND dup.position_name = p.position_name
    AND dup.is_combinable = TRUE
);
