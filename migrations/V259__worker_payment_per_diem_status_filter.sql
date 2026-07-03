-- V259: фильтр статуса при синке worker_payments.per_diem → work_expenses
-- Баг: триггер `sync_worker_payment_to_expense` для type='per_diem' создавал
--      work_expenses на ЛЮБОМ статусе (pending/paid/confirmed/cancelled).
--      Из-за этого pending [AUTO] суточные начисления суммировались с реально
--      выплаченными → в фин отчёте «Структура расходов» сумма ×2.
--      Пример КАО Азот work 11: 1 052 000 (pending) + 1 087 750 (paid+confirmed)
--      = 2 141 750 ₽ вместо корректных 1 087 750.
--
-- Фикс:
--   1. Для per_diem действуем как для bonus:
--      - status IN ('paid','confirmed') → создать/обновить work_expense
--      - status NOT IN ('paid','confirmed') → удалить work_expense (если is_finalized=FALSE)
--   2. Cleanup: удалить все work_expenses где source_id указывает на
--      worker_payments в статусе pending/cancelled и расход не зафиксирован.

CREATE OR REPLACE FUNCTION sync_worker_payment_to_expense() RETURNS TRIGGER AS $$
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

  -- ── per_diem: расход категории per_diem (V259: фильтр статуса) ──
  IF NEW.type = 'per_diem' THEN
    -- Если статус НЕ paid/confirmed — удалить existing расход (не факт выплаты)
    IF NEW.status NOT IN ('paid', 'confirmed') THEN
      DELETE FROM work_expenses
      WHERE source_table = 'worker_payments'
        AND source_id = NEW.id
        AND source_key IS NULL
        AND is_finalized = FALSE;
      RETURN NEW;
    END IF;

    SELECT COALESCE(fio, full_name, 'ID ' || NEW.employee_id)
    INTO _emp_name FROM employees WHERE id = NEW.employee_id;

    _description := 'Суточные: ' || _emp_name || COALESCE(' (' || NEW.days || ' дн.)', '');

    SELECT id, is_finalized INTO _existing_id, _existing_finalized
    FROM work_expenses
    WHERE source_table = 'worker_payments'
      AND source_id = NEW.id
      AND source_key IS NULL;

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

-- Cleanup: удалить уже созданные «фантомные» расходы — pending/cancelled per_diem.
-- Затрагиваем только незафиксированные (is_finalized=FALSE) — закрытые работы
-- не пересчитываем, чтобы не сломать историю.
DELETE FROM work_expenses we
WHERE we.source_table = 'worker_payments'
  AND we.source_key IS NULL
  AND we.category = 'per_diem'
  AND we.is_finalized = FALSE
  AND EXISTS (
    SELECT 1 FROM worker_payments wp
    WHERE wp.id = we.source_id
      AND wp.type = 'per_diem'
      AND wp.status NOT IN ('paid','confirmed')
  );
