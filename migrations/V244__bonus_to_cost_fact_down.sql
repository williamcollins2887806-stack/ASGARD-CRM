-- ═══════════════════════════════════════════════════════════════════════════
-- V244 DOWN: восстановить логику V077 (только per_diem).
-- ВНИМАНИЕ: удаляются ВСЕ work_expenses, созданные V244 backfill'ом
-- (source_table='worker_payments' AND source_key LIKE 'wp_bonus:%'), если они
-- не зафиксированы.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DELETE FROM work_expenses
WHERE source_table = 'worker_payments'
  AND source_key LIKE 'wp_bonus:%'
  AND is_finalized = FALSE;

-- Возвращаем V077-версию функции (только per_diem).
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

COMMIT;
