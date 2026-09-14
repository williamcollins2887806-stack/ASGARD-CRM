-- V344: ФОТ в расходах больше не показывает «ID 12345» вместо ФИО.
--
-- Триггер sync_field_checkin_to_expense брал только employees.full_name.
-- У большинства рабочих заполнено fio, full_name пустой → в work_expenses
-- писалось 'ID <id>'. Плюс после слияния карточек (stub→keeper) агрегаты
-- field_checkins_agg по старому employee_id оставались без смен.
--
-- 1) Триггер: COALESCE(fio, full_name, 'ID N')
-- 2) Backfill fot_employee_name из employees
-- 3) Удалить незафиксированные агрегаты ФОТ, у которых больше нет смен

CREATE OR REPLACE FUNCTION sync_field_checkin_to_expense()
RETURNS TRIGGER AS $$
DECLARE
  _work_id INTEGER;
  _emp_id INTEGER;
  _emp_name TEXT;
  _source_key TEXT;
  _total_amount NUMERIC;
  _total_days INTEGER;
  _min_date DATE;
  _max_date DATE;
  _existing_id INTEGER;
  _existing_finalized BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _work_id := OLD.work_id;
    _emp_id := OLD.employee_id;
  ELSE
    _work_id := NEW.work_id;
    _emp_id := NEW.employee_id;
  END IF;

  IF _work_id IS NULL OR _emp_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  _source_key := _work_id::text || ':' || _emp_id::text;

  SELECT
    COALESCE(SUM(amount_earned), 0),
    COUNT(*),
    MIN(date),
    MAX(date)
  INTO _total_amount, _total_days, _min_date, _max_date
  FROM field_checkins
  WHERE work_id = _work_id
    AND employee_id = _emp_id
    AND (status IN ('closed', 'confirmed', 'completed') OR checkout_at IS NOT NULL);

  SELECT COALESCE(NULLIF(TRIM(fio), ''), NULLIF(TRIM(full_name), ''), 'ID ' || _emp_id)
  INTO _emp_name FROM employees WHERE id = _emp_id;
  IF _emp_name IS NULL THEN _emp_name := 'ID ' || _emp_id; END IF;

  SELECT id, is_finalized INTO _existing_id, _existing_finalized
  FROM work_expenses
  WHERE source_table = 'field_checkins_agg' AND source_key = _source_key;

  IF _existing_id IS NOT NULL AND _existing_finalized = TRUE THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF _total_amount = 0 OR _total_days = 0 THEN
    DELETE FROM work_expenses
    WHERE source_table = 'field_checkins_agg'
      AND source_key = _source_key
      AND is_finalized = FALSE;
  ELSIF _existing_id IS NULL THEN
    INSERT INTO work_expenses (
      work_id, category, payment_method, amount, date,
      employee_id, fot_employee_name,
      description, source, source_table, source_key,
      fot_date_from, fot_date_to, created_at, updated_at
    ) VALUES (
      _work_id, 'fot', 'auto', _total_amount, _max_date,
      _emp_id, _emp_name,
      'ФОТ: ' || _emp_name || ' (' || _total_days || ' смен)', 'auto_field_checkin',
      'field_checkins_agg', _source_key,
      _min_date, _max_date, NOW(), NOW()
    );
  ELSE
    UPDATE work_expenses SET
      amount = _total_amount,
      payment_method = 'auto',
      date = _max_date,
      fot_employee_name = _emp_name,
      fot_date_from = _min_date,
      fot_date_to = _max_date,
      description = 'ФОТ: ' || _emp_name || ' (' || _total_days || ' смен)',
      updated_at = NOW()
    WHERE id = _existing_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Имена: подтянуть fio/full_name туда, где сейчас пусто или 'ID N'
UPDATE work_expenses we
SET fot_employee_name = nm.n,
    description = CASE
      WHEN we.fot_employee_name IS NOT NULL
           AND we.description IS NOT NULL
           AND position(we.fot_employee_name IN we.description) > 0
      THEN replace(we.description, we.fot_employee_name, nm.n)
      ELSE we.description
    END,
    updated_at = NOW()
FROM (
  SELECT e.id,
         COALESCE(NULLIF(TRIM(e.fio), ''), NULLIF(TRIM(e.full_name), '')) AS n
  FROM employees e
) nm
WHERE nm.n IS NOT NULL
  AND (
    we.employee_id = nm.id
    OR (we.fot_employee_name ~ '^ID [0-9]+$'
        AND NULLIF(substring(we.fot_employee_name from '[0-9]+'), '')::int = nm.id)
  )
  AND (we.fot_employee_name IS NULL
       OR btrim(we.fot_employee_name) = ''
       OR we.fot_employee_name ~ '^ID [0-9]+$');

-- Хвосты после merge карточек: агрегат ФОТ без живых смен
DELETE FROM work_expenses we
WHERE we.source_table = 'field_checkins_agg'
  AND COALESCE(we.is_finalized, FALSE) = FALSE
  AND we.employee_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM field_checkins fc
    WHERE fc.work_id = we.work_id
      AND fc.employee_id = we.employee_id
      AND (fc.status IN ('closed', 'confirmed', 'completed') OR fc.checkout_at IS NOT NULL)
  );

COMMENT ON FUNCTION sync_field_checkin_to_expense() IS
  'V344: ФИО из fio/full_name. field_checkins → work_expenses(fot), payment_method=auto.';
