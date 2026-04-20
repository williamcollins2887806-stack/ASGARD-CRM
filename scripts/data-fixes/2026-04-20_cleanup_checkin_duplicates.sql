-- Очистка дублированных чекинов на work_id=11 (КАО Азот)
-- И создание недостающего assignment для Пономарева А.Е.
-- Причина: POST /projects/:id/checkin не имел ON CONFLICT → мастер создал дубли
--           при ручном вводе табеля 20.04.2026 05:54-05:56

BEGIN;

-- ── ПРОВЕРКИ ДО: подсчёт дублей ─────────────────────────────────
DO $$
DECLARE v_dup_count int; v_pon_assign int;
BEGIN
  SELECT COUNT(*) INTO v_dup_count FROM (
    SELECT employee_id, date, work_id
    FROM field_checkins
    WHERE work_id = 11 AND status != 'cancelled'
    GROUP BY employee_id, date, work_id
    HAVING COUNT(*) > 1
  ) sub;

  SELECT COUNT(*) INTO v_pon_assign FROM employee_assignments ea
  JOIN employees e ON e.id = ea.employee_id
  WHERE e.fio ILIKE '%Пономарев%Александр%Евгеньевич%' AND ea.work_id = 11;

  RAISE NOTICE 'ДО: % дат с дублями на work_id=11, Пономарев assignments=%', v_dup_count, v_pon_assign;

  IF v_dup_count = 0 THEN
    RAISE EXCEPTION 'Нет дублей — скрипт уже применён или данные изменились. Отмена.';
  END IF;
END $$;

-- ── ОТМЕНА ДУБЛЕЙ (оставляем самый свежий по created_at) ────────
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY employee_id, date, work_id
           ORDER BY created_at DESC, id DESC
         ) AS rn
  FROM field_checkins
  WHERE work_id = 11
    AND status != 'cancelled'
)
UPDATE field_checkins
SET status = 'cancelled',
    note = COALESCE(note, '') || ' [auto-cancelled 2026-04-20: duplicate checkin cleanup]'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- ── СОЗДАТЬ ASSIGNMENT ДЛЯ ПОНОМАРЕВА ──────────────────────────
DO $$
DECLARE v_tariff_name text;
BEGIN
  SELECT position_name INTO v_tariff_name FROM field_tariff_grid WHERE id = 43;
  IF v_tariff_name NOT ILIKE '%мастер%' THEN
    RAISE EXCEPTION 'tariff_id=43 не мастерский: "%"', v_tariff_name;
  END IF;
END $$;

INSERT INTO employee_assignments (employee_id, work_id, tariff_id, per_diem, is_active, created_at)
SELECT e.id, 11, 43, 1000, true, NOW()
FROM employees e
WHERE e.fio ILIKE '%Пономарев%Александр%Евгеньевич%'
  AND NOT EXISTS (
    SELECT 1 FROM employee_assignments ea
    WHERE ea.employee_id = e.id AND ea.work_id = 11
  );

-- ── ПРОВЕРКИ ПОСЛЕ ──────────────────────────────────────────────
DO $$
DECLARE v_remaining_dups int; v_pon_assign int; v_cancelled int;
BEGIN
  -- Не должно остаться дублей среди active записей
  SELECT COUNT(*) INTO v_remaining_dups FROM (
    SELECT employee_id, date, work_id
    FROM field_checkins
    WHERE work_id = 11 AND status != 'cancelled'
    GROUP BY employee_id, date, work_id
    HAVING COUNT(*) > 1
  ) sub;

  SELECT COUNT(*) INTO v_pon_assign FROM employee_assignments ea
  JOIN employees e ON e.id = ea.employee_id
  WHERE e.fio ILIKE '%Пономарев%Александр%Евгеньевич%' AND ea.work_id = 11;

  SELECT COUNT(*) INTO v_cancelled FROM field_checkins
  WHERE work_id = 11 AND note LIKE '%auto-cancelled 2026-04-20%';

  RAISE NOTICE 'ПОСЛЕ: remaining_dups=% (ожидаем 0), Пономарев assignments=% (ожидаем 1), cancelled=%',
    v_remaining_dups, v_pon_assign, v_cancelled;

  IF v_remaining_dups != 0 THEN
    RAISE EXCEPTION 'Остались дубли: %. ROLLBACK.', v_remaining_dups;
  END IF;
  IF v_pon_assign != 1 THEN
    RAISE EXCEPTION 'Пономарев: ожидался 1 assignment, получили %. ROLLBACK.', v_pon_assign;
  END IF;
  IF v_cancelled = 0 THEN
    RAISE EXCEPTION 'Ничего не отменено — скрипт не сработал. ROLLBACK.';
  END IF;

  RAISE NOTICE 'OK: cleanup прошёл корректно, отменено % дублей', v_cancelled;
END $$;

COMMIT;
