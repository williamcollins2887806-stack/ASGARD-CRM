-- ═══════════════════════════════════════════════════════════════════════════
-- V244: bonus попадает в cost_fact (work_expenses category='fot', subcat='bonus')
-- ═══════════════════════════════════════════════════════════════════════════
-- Баг #5 (STAGE_W_CONTRACT.md): директор начислил рабочему премию через
-- worker_payments (type='bonus'), бух выплатил, но в cost_fact работы
-- запись не создавалась — V077 явно исключал bonus. В результате премии
-- не отражались в фактической себестоимости работы.
--
-- Фикс: расширяем sync_worker_payment_to_expense() — bonus, если выплачен
-- (status IN paid/confirmed) И привязан к work_id, ТОЖЕ создаёт расход.
--   category='fot'    — фонд оплаты труда (как зарплата)
--   subcategory=NULL  — V219 запрещает subcategory под fot
--   payment_method='auto' — V230 паттерн «авто-агрегат из триггера»
--   source_key='wp_bonus:N' — уникальность через partial unique index V071
--                              idx_work_expenses_source_key (source_table+source_key)
--
-- per_diem остаётся без изменений (логика V077).
-- salary/advance не пишутся в work_expenses — ФОТ уже учтён через V072
-- (sync_field_checkin_to_expense). Премия — НЕ ФОТ от смен, поэтому пишем.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION sync_worker_payment_to_expense()
RETURNS TRIGGER AS $$
DECLARE
  _emp_name TEXT;
  _description TEXT;
  _existing_id INTEGER;
  _existing_finalized BOOLEAN;
  _bonus_existing_id INTEGER;
  _bonus_existing_finalized BOOLEAN;
BEGIN
  -- ── DELETE: убираем расход, если он не зафиксирован ──
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

  -- ── per_diem: расход категории per_diem (логика V077) ──
  IF NEW.type = 'per_diem' THEN
    SELECT COALESCE(fio, full_name, 'ID ' || NEW.employee_id)
    INTO _emp_name FROM employees WHERE id = NEW.employee_id;

    _description := 'Суточные: ' || _emp_name || COALESCE(' (' || NEW.days || ' дн.)', '');

    SELECT id, is_finalized INTO _existing_id, _existing_finalized
    FROM work_expenses
    WHERE source_table = 'worker_payments'
      AND source_id = NEW.id
      AND source_key IS NULL;  -- per_diem пишется БЕЗ source_key (1:1 по source_id)

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
  END IF;

  -- ── V244: bonus → work_expenses(fot) только когда выплачен и есть work_id ──
  IF NEW.type = 'bonus'
     AND NEW.status IN ('paid', 'confirmed')
     AND NEW.work_id IS NOT NULL THEN

    SELECT COALESCE(fio, full_name, 'ID ' || NEW.employee_id)
    INTO _emp_name FROM employees WHERE id = NEW.employee_id;

    SELECT id, is_finalized INTO _bonus_existing_id, _bonus_existing_finalized
    FROM work_expenses
    WHERE source_table = 'worker_payments'
      AND source_key = 'wp_bonus:' || NEW.id;

    IF _bonus_existing_id IS NOT NULL AND _bonus_existing_finalized = TRUE THEN
      -- работа уже закрыта — не трогаем
      NULL;
    ELSIF _bonus_existing_id IS NULL THEN
      INSERT INTO work_expenses (
        work_id, category, amount, date, employee_id, fot_employee_name,
        description, source, source_table, source_id, source_key,
        payment_method, created_at, updated_at
      ) VALUES (
        NEW.work_id, 'fot', NEW.amount,
        COALESCE(NEW.paid_at::date, CURRENT_DATE),
        NEW.employee_id, _emp_name,
        'Премия: ' || _emp_name || ' (#' || NEW.id || ')',
        'auto_worker_payment', 'worker_payments', NEW.id,
        'wp_bonus:' || NEW.id, 'auto', NOW(), NOW()
      );
    ELSE
      UPDATE work_expenses SET
        amount = NEW.amount,
        description = 'Премия: ' || _emp_name || ' (#' || NEW.id || ')',
        date = COALESCE(NEW.paid_at::date, CURRENT_DATE),
        payment_method = 'auto',
        updated_at = NOW()
      WHERE id = _bonus_existing_id;
    END IF;
  END IF;

  -- ── Если bonus отменён (cancelled / pending) — удаляем расход ──
  IF NEW.type = 'bonus'
     AND NEW.status NOT IN ('paid', 'confirmed')
     AND TG_OP = 'UPDATE' THEN
    DELETE FROM work_expenses
    WHERE source_table = 'worker_payments'
      AND source_key = 'wp_bonus:' || NEW.id
      AND is_finalized = FALSE;
  END IF;

  -- salary/advance: НЕ создают work_expenses (ФОТ уже учтён через V072).
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION sync_worker_payment_to_expense() IS
  'V244: per_diem + bonus(paid/confirmed) → work_expenses. salary/advance — не расходы (ФОТ через V072).';

-- Backfill: для уже-выплаченных премий, для которых ещё нет work_expenses,
-- создаём записи. Берём только paid/confirmed с work_id IS NOT NULL.
INSERT INTO work_expenses (
  work_id, category, amount, date, employee_id, fot_employee_name,
  description, source, source_table, source_id, source_key,
  payment_method, created_at, updated_at
)
SELECT
  wp.work_id,
  'fot',
  wp.amount,
  COALESCE(wp.paid_at::date, CURRENT_DATE),
  wp.employee_id,
  COALESCE(e.fio, e.full_name, 'ID ' || wp.employee_id),
  'Премия: ' || COALESCE(e.fio, e.full_name, 'ID ' || wp.employee_id) || ' (#' || wp.id || ')',
  'auto_worker_payment',
  'worker_payments',
  wp.id,
  'wp_bonus:' || wp.id,
  'auto',
  NOW(), NOW()
FROM worker_payments wp
LEFT JOIN employees e ON e.id = wp.employee_id
WHERE wp.type = 'bonus'
  AND wp.status IN ('paid', 'confirmed')
  AND wp.work_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM work_expenses we
    WHERE we.source_table = 'worker_payments'
      AND we.source_key = 'wp_bonus:' || wp.id
  );

COMMIT;
