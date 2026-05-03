-- Backfill field_checkins.assignment_id из employee_assignments
-- Контекст: 328 строк в проде имеют assignment_id = NULL.
-- Эндпоинты field-manage.js:733 и worker-payments.js:1140 никогда не заполняли FK.
-- Fallback LATERAL в SSoT находит по (employee_id, work_id) — 100% покрытие.
-- После backfill миграция V088 добавит NOT NULL constraint,
-- и из SSoT (src/lib/worker-finances.js) удалим LATERAL-костыль.

-- Backfill через LATERAL: для каждого чекина найти лучший assignment
-- (is_active DESC, id DESC — самый свежий активный)

UPDATE field_checkins fc
SET assignment_id = (
  SELECT id
  FROM employee_assignments ea
  WHERE ea.employee_id = fc.employee_id
    AND ea.work_id = fc.work_id
  ORDER BY ea.is_active DESC, ea.id DESC
  LIMIT 1
)
WHERE fc.assignment_id IS NULL;

-- Проверка: все ли проставились
DO $$
DECLARE v_null_remaining int;
BEGIN
  SELECT COUNT(*) INTO v_null_remaining FROM field_checkins WHERE assignment_id IS NULL;
  IF v_null_remaining > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % rows still NULL', v_null_remaining;
  END IF;
  RAISE NOTICE 'OK: all field_checkins rows now have assignment_id';
END $$;
