-- V324: суточные по календарному месяцу + этапы; МЛСП-вахта не входит.
-- Старый триггер V076 клал ВСЕ дни смены в одну pending-запись в месяц MAX(date)
-- и не смотрел per_diem_on_checkins / field_trip_stages.

CREATE OR REPLACE FUNCTION asgard_per_diem_default_rate()
RETURNS numeric
LANGUAGE sql
STABLE
AS $$
  SELECT 1000::numeric;
$$;

-- SSoT дней суточных за интервал (как src/lib/worker-per-diem-days.js).
CREATE OR REPLACE FUNCTION asgard_per_diem_ssot_days(
  p_emp_ids int[],
  p_from date,
  p_to date
)
RETURNS TABLE (
  employee_id int,
  day date,
  work_id int,
  source text,
  rate numeric
)
LANGUAGE sql
STABLE
AS $$
  WITH stage_days AS (
    SELECT
      fts.employee_id,
      d.day::date AS day,
      fts.work_id,
      'stage'::text AS source
    FROM field_trip_stages fts
    CROSS JOIN LATERAL generate_series(
      fts.date_from::date,
      COALESCE(fts.date_to, fts.date_from)::date,
      '1 day'::interval
    ) AS d(day)
    WHERE fts.employee_id = ANY(p_emp_ids)
      AND COALESCE(fts.status, 'active') NOT IN ('cancelled', 'rejected')
      AND fts.stage_type IN ('warehouse','medical','travel','ship','training','helicopter','waiting')
      AND d.day BETWEEN p_from AND p_to
      AND COALESCE(fts.date_to, fts.date_from) >= fts.date_from
  ),
  checkin_days AS (
    SELECT
      fc.employee_id,
      fc.date::date AS day,
      fc.work_id,
      'checkin'::text AS source
    FROM field_checkins fc
    LEFT JOIN employee_assignments ea ON ea.id = fc.assignment_id
    LEFT JOIN field_project_settings fps ON fps.work_id = fc.work_id
    WHERE fc.employee_id = ANY(p_emp_ids)
      AND fc.status = 'completed'
      AND fc.date BETWEEN p_from AND p_to
      AND COALESCE(fps.per_diem_on_checkins, true) = true
      AND COALESCE(NULLIF(ea.per_diem, 0), NULLIF(fps.per_diem, 0), 0) > 0
  ),
  unioned AS (
    SELECT * FROM stage_days
    UNION ALL
    SELECT * FROM checkin_days
  ),
  dedup AS (
    SELECT DISTINCT ON (u.employee_id, u.day)
      u.employee_id, u.day, u.work_id, u.source
    FROM unioned u
    ORDER BY u.employee_id, u.day,
      CASE WHEN u.work_id IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN u.source = 'stage' THEN 0 ELSE 1 END
  )
  SELECT
    d.employee_id,
    d.day,
    d.work_id,
    d.source,
    COALESCE(
      NULLIF((
        SELECT ea.per_diem FROM employee_assignments ea
        WHERE ea.employee_id = d.employee_id
          AND (d.work_id IS NULL OR ea.work_id = d.work_id)
          AND COALESCE(ea.is_active, true) = true
        ORDER BY
          CASE WHEN d.work_id IS NOT NULL AND ea.work_id = d.work_id THEN 0 ELSE 1 END,
          ea.id DESC
        LIMIT 1
      ), 0),
      NULLIF((
        SELECT fps.per_diem FROM field_project_settings fps
        WHERE d.work_id IS NOT NULL AND fps.work_id = d.work_id
        LIMIT 1
      ), 0),
      asgard_per_diem_default_rate()
    ) AS rate
  FROM dedup d;
$$;

COMMENT ON FUNCTION asgard_per_diem_ssot_days(int[], date, date) IS
  'V324: календарь суточных (этапы всегда; смены только если per_diem_on_checkins).';

-- Пересчёт pending [AUTO-MONTH] за интервал: не трогает paid/confirmed.
-- Одна строка на сотрудника × календарный месяц (как колонка табеля).
CREATE OR REPLACE FUNCTION recalc_per_diem_auto_months(
  p_emp_ids int[],
  p_from date,
  p_to date
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
  _paid numeric;
  _remainder numeric;
  _existing_id int;
  _existing_status text;
  _comment text;
  _month_start date;
BEGIN
  IF p_emp_ids IS NULL OR array_length(p_emp_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT
      s.employee_id,
      EXTRACT(YEAR FROM s.day)::int AS y,
      EXTRACT(MONTH FROM s.day)::int AS m,
      COUNT(*)::int AS days,
      SUM(s.rate)::numeric AS accrued,
      MIN(s.day) AS d0,
      MAX(s.day) AS d1,
      MAX(s.work_id) AS work_id
    FROM asgard_per_diem_ssot_days(p_emp_ids, p_from, p_to) s
    GROUP BY s.employee_id, 2, 3
  LOOP
    _month_start := make_date(r.y, r.m, 1);
    _comment := '[AUTO-MONTH] ' || to_char(_month_start, 'YYYY-MM');

    SELECT COALESCE(SUM(wp.amount), 0) INTO _paid
    FROM worker_payments wp
    WHERE wp.employee_id = r.employee_id
      AND wp.type = 'per_diem'
      AND wp.status IN ('paid', 'confirmed')
      AND CASE
            WHEN wp.pay_year IS NOT NULL AND wp.pay_month IS NOT NULL
              THEN make_date(wp.pay_year, wp.pay_month, 1)
            ELSE COALESCE(
              date_trunc('month', wp.period_from)::date,
              date_trunc('month', (wp.paid_at AT TIME ZONE 'Europe/Moscow'))::date
            )
          END = _month_start;

    _remainder := ROUND(COALESCE(r.accrued, 0)) - ROUND(COALESCE(_paid, 0));
    IF _remainder < 0 THEN _remainder := 0; END IF;

    SELECT wp.id, wp.status INTO _existing_id, _existing_status
    FROM worker_payments wp
    WHERE wp.employee_id = r.employee_id
      AND wp.type = 'per_diem'
      AND wp.comment LIKE _comment || '%'
    ORDER BY wp.id DESC
    LIMIT 1;

    IF _existing_id IS NOT NULL AND _existing_status IN ('paid', 'confirmed') THEN
      CONTINUE;
    END IF;

    IF _remainder <= 0 THEN
      IF _existing_id IS NOT NULL AND _existing_status = 'pending' THEN
        UPDATE worker_payments
        SET status = 'cancelled',
            comment = COALESCE(comment, '') || ' [cancel: remainder 0]',
            updated_at = NOW()
        WHERE id = _existing_id;
      END IF;
      CONTINUE;
    END IF;

    IF _existing_id IS NULL THEN
      INSERT INTO worker_payments (
        employee_id, work_id, type, period_from, period_to, pay_month, pay_year,
        amount, days, rate_per_day, status, payment_method, comment, created_at, updated_at
      ) VALUES (
        r.employee_id, r.work_id, 'per_diem', r.d0, r.d1, r.m, r.y,
        _remainder, r.days, asgard_per_diem_default_rate(), 'pending', 'auto',
        _comment || ' (' || r.days || ' дн.)',
        NOW(), NOW()
      );
    ELSE
      UPDATE worker_payments SET
        work_id = COALESCE(r.work_id, work_id),
        period_from = r.d0,
        period_to = r.d1,
        pay_month = r.m,
        pay_year = r.y,
        amount = _remainder,
        days = r.days,
        rate_per_day = asgard_per_diem_default_rate(),
        status = 'pending',
        comment = _comment || ' (' || r.days || ' дн.)',
        updated_at = NOW()
      WHERE id = _existing_id;
    END IF;
  END LOOP;
END;
$$;

-- Замена V076: считать только затронутый месяц, по SSoT.
CREATE OR REPLACE FUNCTION sync_per_diem_from_checkins()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  _emp int;
  _d0 date;
  _d1 date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _emp := OLD.employee_id;
    _d0 := OLD.date;
    _d1 := OLD.date;
  ELSE
    _emp := NEW.employee_id;
    _d0 := NEW.date;
    _d1 := NEW.date;
  END IF;
  IF _emp IS NULL OR _d0 IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM recalc_per_diem_auto_months(
    ARRAY[_emp],
    date_trunc('month', _d0)::date,
    (date_trunc('month', _d1) + interval '1 month - 1 day')::date
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION sync_per_diem_from_checkins() IS
  'V324: суточные pending по календарному месяцу (SSoT). Не трогает paid.';

CREATE OR REPLACE FUNCTION sync_per_diem_from_stages()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  _emp int;
  _d0 date;
  _d1 date;
BEGIN
  IF TG_OP = 'DELETE' THEN
    _emp := OLD.employee_id;
    _d0 := OLD.date_from;
    _d1 := COALESCE(OLD.date_to, OLD.date_from);
  ELSE
    _emp := NEW.employee_id;
    _d0 := NEW.date_from;
    _d1 := COALESCE(NEW.date_to, NEW.date_from);
    IF TG_OP = 'UPDATE' THEN
      _d0 := LEAST(_d0, OLD.date_from);
      _d1 := GREATEST(_d1, COALESCE(OLD.date_to, OLD.date_from));
    END IF;
  END IF;
  IF _emp IS NULL OR _d0 IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  PERFORM recalc_per_diem_auto_months(
    ARRAY[_emp],
    date_trunc('month', _d0)::date,
    (date_trunc('month', _d1) + interval '1 month - 1 day')::date
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_per_diem_stages ON field_trip_stages;
CREATE TRIGGER trg_sync_per_diem_stages
AFTER INSERT OR UPDATE OR DELETE ON field_trip_stages
FOR EACH ROW EXECUTE FUNCTION sync_per_diem_from_stages();

CREATE INDEX IF NOT EXISTS idx_wp_auto_month
  ON worker_payments (employee_id, pay_year, pay_month)
  WHERE type = 'per_diem' AND comment LIKE '[AUTO-MONTH]%';
