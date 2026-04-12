-- V072a: Добавить 'completed' в условие триггера sync_field_checkin_to_expense
-- Статус field_checkins может быть 'closed', 'confirmed' ИЛИ 'completed'

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

  -- ИСПРАВЛЕНО: добавлен 'completed' в список "закрытых" статусов
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

  SELECT full_name INTO _emp_name FROM employees WHERE id = _emp_id;
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
      work_id, category, amount, date, employee_id, fot_employee_name,
      description, source, source_table, source_key,
      fot_date_from, fot_date_to, created_at, updated_at
    ) VALUES (
      _work_id, 'fot', _total_amount, _max_date, _emp_id, _emp_name,
      'ФОТ: ' || _emp_name || ' (' || _total_days || ' смен)', 'auto_field_checkin',
      'field_checkins_agg', _source_key,
      _min_date, _max_date, NOW(), NOW()
    );
  ELSE
    UPDATE work_expenses SET
      amount = _total_amount,
      date = _max_date,
      fot_date_from = _min_date,
      fot_date_to = _max_date,
      description = 'ФОТ: ' || _emp_name || ' (' || _total_days || ' смен)',
      updated_at = NOW()
    WHERE id = _existing_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Backfill снова — теперь с 'completed'
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT work_id, employee_id FROM field_checkins
    WHERE work_id IS NOT NULL AND employee_id IS NOT NULL
  LOOP
    UPDATE field_checkins SET updated_at = COALESCE(updated_at, NOW())
    WHERE id = (SELECT id FROM field_checkins
                WHERE work_id = r.work_id AND employee_id = r.employee_id
                ORDER BY id DESC LIMIT 1);
  END LOOP;
END$$;
