-- ============================================================================
-- V395: Doc Hub — вспомогательная функция для светофора.
-- Считает число РАБОЧИХ дней от завтра до целевой даты включительно,
-- с учётом work_calendar (переносы/праздники). Если записи нет — сб/вс
-- нерабочие, остальные рабочие (производственный календарь РФ).
-- STABLE: зависит только от таблиц, не от транзакции → планировщик кэширует.
-- Идемпотентно (CREATE OR REPLACE).
-- ============================================================================

CREATE OR REPLACE FUNCTION asgard_workdays_until(p_target date)
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN p_target IS NULL OR p_target < CURRENT_DATE THEN 0
    ELSE COALESCE((
      SELECT SUM(
        CASE
          WHEN wc.is_working IS NOT NULL THEN (CASE WHEN wc.is_working THEN 1 ELSE 0 END)
          WHEN EXTRACT(ISODOW FROM gs)::int < 6 THEN 1
          ELSE 0
        END
      )::int
      FROM generate_series(CURRENT_DATE + 1, p_target, interval '1 day') gs
      LEFT JOIN work_calendar wc ON wc.date = gs::date
    ), 0)
  END
$$;

COMMENT ON FUNCTION asgard_workdays_until(date) IS
  'V395: рабочих дней от завтра до p_target (0 если срок уже наступил/в прошлом). '
  'Источник: work_calendar + правило сб/вс. Для светофора Doc Hub (жёлтый ≤ N раб. дней).';
