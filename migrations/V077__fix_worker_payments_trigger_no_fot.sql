-- V077: Фикс триггера V073 — salary/advance/bonus НЕ создают расход
--
-- Проблема: salary и advance дублировали ФОТ в work_expenses.
-- ФОТ уже учтён через field_checkins → V072 (начисление).
-- Выплата зарплаты/аванса — это оплата начисленного ФОТ, а не новый расход.
--
-- Правильная архитектура:
--   field_checkins → V072 → work_expenses (fot) — НАЧИСЛЕНИЕ
--   worker_payments (salary/advance) — ВЫПЛАТА (не расход, не в work_expenses)
--   worker_payments (per_diem) → V073 → work_expenses (per_diem) — РАСХОД (суточные)

CREATE OR REPLACE FUNCTION sync_worker_payment_to_expense()
RETURNS TRIGGER AS $$
DECLARE
  _emp_name TEXT;
  _description TEXT;
  _existing_id INTEGER;
  _existing_finalized BOOLEAN;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM work_expenses
    WHERE source_table = 'worker_payments'
      AND source_id = OLD.id
      AND is_finalized = FALSE;
    RETURN OLD;
  END IF;

  IF NEW.work_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- ТОЛЬКО per_diem создаёт расход в work_expenses
  -- salary/advance/bonus — это выплаты, НЕ расходы (ФОТ уже учтён через V072)
  IF NEW.type NOT IN ('per_diem') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(fio, full_name, 'ID ' || NEW.employee_id)
  INTO _emp_name FROM employees WHERE id = NEW.employee_id;

  _description := 'Суточные: ' || _emp_name || COALESCE(' (' || NEW.days || ' дн.)', '');

  SELECT id, is_finalized INTO _existing_id, _existing_finalized
  FROM work_expenses
  WHERE source_table = 'worker_payments' AND source_id = NEW.id;

  IF _existing_id IS NOT NULL AND _existing_finalized = TRUE THEN
    RETURN NEW;
  END IF;

  IF _existing_id IS NULL THEN
    INSERT INTO work_expenses (
      work_id, category, amount, date, employee_id, fot_employee_name,
      description, source, source_table, source_id,
      created_at, updated_at
    ) VALUES (
      NEW.work_id, 'per_diem', NEW.amount,
      COALESCE(NEW.paid_at::date, NEW.period_to, NEW.period_from, CURRENT_DATE),
      NEW.employee_id, _emp_name, _description, 'auto_worker_payment',
      'worker_payments', NEW.id,
      NOW(), NOW()
    );
  ELSE
    UPDATE work_expenses SET
      amount = NEW.amount,
      description = _description,
      date = COALESCE(NEW.paid_at::date, NEW.period_to, NEW.period_from, CURRENT_DATE),
      updated_at = NOW()
    WHERE id = _existing_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Удаляем ошибочно созданные work_expenses от salary/advance/bonus
DELETE FROM work_expenses
WHERE source_table = 'worker_payments'
  AND is_finalized = FALSE
  AND source_id IN (
    SELECT id FROM worker_payments WHERE type IN ('salary', 'advance', 'bonus')
  );

COMMENT ON FUNCTION sync_worker_payment_to_expense() IS 'V077: Только per_diem → work_expenses. Salary/advance/bonus — выплаты, не расходы.';
