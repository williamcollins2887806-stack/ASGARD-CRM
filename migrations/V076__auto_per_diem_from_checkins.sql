-- V076: Автоматическое начисление суточных при наличии смен
-- При INSERT/UPDATE/DELETE field_checkins — пересчитываем worker_payments per_diem
-- агрегированно по (work_id, employee_id).
-- Логика:
--   - Берём все checkins с amount_earned > 0 (любые баллы, включая дорогу)
--   - Считаем количество уникальных дней
--   - Ставка: employee_assignments.per_diem → field_project_settings.per_diem → 1000
--   - UPSERT worker_payment (один на пару work+employee+'per_diem_auto')
--   - НЕ трогаем существующие worker_payments со status='paid' или 'confirmed'

-- 1. Маркер для авто-созданных per_diem (используем поле comment как идентификатор)
-- worker_payments не имеет source_table, поэтому используем комментарий-маркер

CREATE OR REPLACE FUNCTION sync_per_diem_from_checkins()
RETURNS TRIGGER AS $$
DECLARE
  _work_id INTEGER;
  _emp_id INTEGER;
  _days_count INTEGER;
  _min_date DATE;
  _max_date DATE;
  _rate NUMERIC;
  _amount NUMERIC;
  _existing_id INTEGER;
  _existing_status TEXT;
  _pay_year INTEGER;
  _pay_month INTEGER;
BEGIN
  -- Определяем затронутую пару (work_id, employee_id)
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

  -- Считаем дни с положительным заработком (любые смены — рабочие, дорога, ожидание)
  SELECT
    COUNT(DISTINCT date),
    MIN(date),
    MAX(date)
  INTO _days_count, _min_date, _max_date
  FROM field_checkins
  WHERE work_id = _work_id
    AND employee_id = _emp_id
    AND COALESCE(amount_earned, 0) > 0
    AND status IN ('completed', 'closed', 'confirmed');

  -- Получаем ставку суточных
  SELECT COALESCE(ea.per_diem, fps.per_diem, 1000)
  INTO _rate
  FROM employee_assignments ea
  LEFT JOIN field_project_settings fps ON fps.work_id = _work_id
  WHERE ea.work_id = _work_id AND ea.employee_id = _emp_id
  LIMIT 1;

  IF _rate IS NULL OR _rate <= 0 THEN _rate := 1000; END IF;

  _amount := _days_count * _rate;
  _pay_year := EXTRACT(YEAR FROM COALESCE(_max_date, CURRENT_DATE))::int;
  _pay_month := EXTRACT(MONTH FROM COALESCE(_max_date, CURRENT_DATE))::int;

  -- Ищем существующую авто-запись (по маркеру в comment)
  SELECT id, status INTO _existing_id, _existing_status
  FROM worker_payments
  WHERE work_id = _work_id
    AND employee_id = _emp_id
    AND type = 'per_diem'
    AND comment LIKE '[AUTO]%'
  LIMIT 1;

  -- Не трогаем уже выплаченные (paid/confirmed) — даже авто
  IF _existing_id IS NOT NULL AND _existing_status IN ('paid', 'confirmed') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF _days_count = 0 THEN
    -- Нет смен — удаляем авто-запись (если есть и не выплачена)
    IF _existing_id IS NOT NULL THEN
      DELETE FROM worker_payments WHERE id = _existing_id;
    END IF;
  ELSIF _existing_id IS NULL THEN
    -- Создаём новую авто-запись
    INSERT INTO worker_payments (
      employee_id, work_id, type, period_from, period_to, pay_month, pay_year,
      amount, days, rate_per_day, status, comment, created_at, updated_at
    ) VALUES (
      _emp_id, _work_id, 'per_diem', _min_date, _max_date, _pay_month, _pay_year,
      _amount, _days_count, _rate, 'pending',
      '[AUTO] Суточные из табеля (' || _days_count || ' дн.)',
      NOW(), NOW()
    );
  ELSE
    -- Обновляем существующую авто-запись
    UPDATE worker_payments SET
      period_from = _min_date,
      period_to = _max_date,
      pay_month = _pay_month,
      pay_year = _pay_year,
      amount = _amount,
      days = _days_count,
      rate_per_day = _rate,
      comment = '[AUTO] Суточные из табеля (' || _days_count || ' дн.)',
      updated_at = NOW()
    WHERE id = _existing_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_per_diem_checkins ON field_checkins;
CREATE TRIGGER trg_sync_per_diem_checkins
AFTER INSERT OR UPDATE OR DELETE ON field_checkins
FOR EACH ROW EXECUTE FUNCTION sync_per_diem_from_checkins();

COMMENT ON FUNCTION sync_per_diem_from_checkins() IS 'V076: Автогенерация суточных при наличии смен. Помечает авто-записи [AUTO] в comment. Не трогает paid/confirmed.';
