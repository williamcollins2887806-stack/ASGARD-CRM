-- ═══════════════════════════════════════════════════════════════════════════
-- V451: Оплата труда без баллов — ставки и доплаты в рублях (с 01.11.2026)
--
-- Канон: суммы те же (бывшие баллы × 500), UI/API работают в ₽, шаг 10.
-- amount_earned / day_rate в checkins уже в рублях — историю не пересчитываем.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1) Доплата назначения в рублях
ALTER TABLE employee_assignments
  ADD COLUMN IF NOT EXISTS manual_extra_rub NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE employee_assignments
  ADD COLUMN IF NOT EXISTS day_rate_rub NUMERIC(12,2);

-- Backfill: ручные баллы × 500 + сумма rate_per_shift по combo_tariff_ids
UPDATE employee_assignments ea
SET manual_extra_rub = ROUND((
  COALESCE(ea.manual_extra_points, 0) * COALESCE(
    (SELECT ftg.point_value FROM field_tariff_grid ftg WHERE ftg.id = ea.tariff_id),
    500
  )
  + COALESCE((
    SELECT SUM(COALESCE(ctg.rate_per_shift, 0))
    FROM unnest(COALESCE(ea.combo_tariff_ids, ARRAY[]::int[])) AS cid(id)
    LEFT JOIN field_tariff_grid ctg ON ctg.id = cid.id
  ), 0)
  + CASE
      WHEN COALESCE(cardinality(ea.combo_tariff_ids), 0) = 0
           AND ea.combination_tariff_id IS NOT NULL
      THEN COALESCE((
        SELECT rate_per_shift FROM field_tariff_grid WHERE id = ea.combination_tariff_id
      ), 0)
      ELSE 0
    END
)::numeric, 2)
WHERE COALESCE(ea.manual_extra_rub, 0) = 0
  AND (
    COALESCE(ea.manual_extra_points, 0) <> 0
    OR COALESCE(cardinality(ea.combo_tariff_ids), 0) > 0
    OR ea.combination_tariff_id IS NOT NULL
  );

-- Итоговая ставка назначения (база тарифа + доплата)
UPDATE employee_assignments ea
SET day_rate_rub = ROUND((
  COALESCE((SELECT rate_per_shift FROM field_tariff_grid WHERE id = ea.tariff_id), 0)
  + COALESCE(ea.manual_extra_rub, 0)
)::numeric, 2)
WHERE ea.day_rate_rub IS NULL
  AND ea.tariff_id IS NOT NULL;

-- 2) Ставки этапов табеля в рублях
ALTER TABLE position_points
  ADD COLUMN IF NOT EXISTS rate_rub NUMERIC(12,2);

UPDATE position_points
SET rate_rub = ROUND((points::numeric * 500), 2)
WHERE rate_rub IS NULL AND points IS NOT NULL;

-- 3) role_base_rates JSON: points → rate_rub (идемпотентно, только если нет rate_rub)
DO $$
DECLARE
  r RECORD;
  roles jsonb;
  role_item jsonb;
  new_roles jsonb;
  pts numeric;
  rate numeric;
  i int;
BEGIN
  FOR r IN
    SELECT work_id, role_base_rates
    FROM field_project_settings
    WHERE role_base_rates IS NOT NULL
      AND role_base_rates ? 'roles'
  LOOP
    roles := r.role_base_rates->'roles';
    IF jsonb_typeof(roles) <> 'array' THEN
      CONTINUE;
    END IF;
    new_roles := '[]'::jsonb;
    FOR i IN 0 .. jsonb_array_length(roles) - 1 LOOP
      role_item := roles->i;
      IF role_item ? 'rate_rub' AND (role_item->>'rate_rub') IS NOT NULL THEN
        new_roles := new_roles || jsonb_build_array(role_item);
        CONTINUE;
      END IF;
      pts := NULLIF(role_item->>'points', '')::numeric;
      IF pts IS NULL THEN
        pts := NULLIF(role_item->>'tariff_points', '')::numeric;
      END IF;
      rate := NULLIF(role_item->>'rate', '')::numeric;
      IF rate IS NULL AND pts IS NOT NULL THEN
        rate := pts * 500;
      END IF;
      IF rate IS NOT NULL THEN
        role_item := role_item || jsonb_build_object('rate_rub', rate);
      END IF;
      new_roles := new_roles || jsonb_build_array(role_item);
    END LOOP;
    UPDATE field_project_settings
    SET role_base_rates = jsonb_set(role_base_rates, '{roles}', new_roles, true)
    WHERE work_id = r.work_id;
  END LOOP;
END $$;

COMMENT ON COLUMN employee_assignments.manual_extra_rub IS
  'Доплата к базовой ставке в рублях (с 01.11.2026; раньше manual_extra_points × 500 + combo)';
COMMENT ON COLUMN employee_assignments.day_rate_rub IS
  'Итоговая дневная ставка назначения в рублях (база + доплата)';
COMMENT ON COLUMN position_points.rate_rub IS
  'Ставка этапа в рублях (бывшие points × 500)';
