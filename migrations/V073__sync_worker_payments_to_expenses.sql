-- V073: Автосинк worker_payments → work_expenses (сразу при создании)
-- Логика:
--   worker_payments.type='per_diem' → category='per_diem' (суточные)
--   worker_payments.type='salary'   → category='fot' (зарплата)
--   worker_payments.type='advance'  → category='fot' (аванс рабочему)
--   worker_payments.type='bonus'    → category='fot' (премия)
-- 1:1 sync: одна запись worker_payments = одна запись work_expenses
-- Связь через source_table='worker_payments', source_id=worker_payment.id
-- Если is_finalized=TRUE — не трогаем.

CREATE OR REPLACE FUNCTION sync_worker_payment_to_expense()
RETURNS TRIGGER AS $$
DECLARE
  _emp_name TEXT;
  _category TEXT;
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

  -- Skip если work_id нет
  IF NEW.work_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Маппинг типа
  _category := CASE NEW.type
    WHEN 'per_diem' THEN 'per_diem'
    WHEN 'salary'   THEN 'fot'
    WHEN 'advance'  THEN 'fot'
    WHEN 'bonus'    THEN 'fot'
    ELSE 'fot'
  END;

  SELECT full_name INTO _emp_name FROM employees WHERE id = NEW.employee_id;
  IF _emp_name IS NULL THEN _emp_name := 'ID ' || NEW.employee_id; END IF;

  _description := CASE NEW.type
    WHEN 'per_diem' THEN 'Суточные: ' || _emp_name || COALESCE(' (' || NEW.days || ' дн.)', '')
    WHEN 'salary'   THEN 'Зарплата: ' || _emp_name
    WHEN 'advance'  THEN 'Аванс: ' || _emp_name
    WHEN 'bonus'    THEN 'Премия: ' || _emp_name
    ELSE _emp_name
  END;

  -- Проверяем существующую запись
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
      NEW.work_id, _category, NEW.amount,
      COALESCE(NEW.paid_at::date, NEW.period_to, NEW.period_from, CURRENT_DATE),
      NEW.employee_id, _emp_name, _description, 'auto_worker_payment',
      'worker_payments', NEW.id,
      NOW(), NOW()
    );
  ELSE
    UPDATE work_expenses SET
      amount = NEW.amount,
      category = _category,
      description = _description,
      date = COALESCE(NEW.paid_at::date, NEW.period_to, NEW.period_from, CURRENT_DATE),
      updated_at = NOW()
    WHERE id = _existing_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_worker_payment_expense ON worker_payments;
CREATE TRIGGER trg_sync_worker_payment_expense
AFTER INSERT OR UPDATE OR DELETE ON worker_payments
FOR EACH ROW EXECUTE FUNCTION sync_worker_payment_to_expense();

-- Backfill существующих worker_payments
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM worker_payments WHERE work_id IS NOT NULL
  LOOP
    UPDATE worker_payments SET updated_at = COALESCE(updated_at, NOW())
    WHERE id = r.id;
  END LOOP;
END$$;
