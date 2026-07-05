-- ═══════════════════════════════════════════════════════════════════════════
-- V272: архив просроченных дублей employee_permits
--
-- Правило: если у (employee_id, type_id) есть действующий допуск
-- (expiry_date IS NULL OR expiry_date >= CURRENT_DATE) — все просроченные
-- активные дубли того же типа архивируются (is_active = false).
--
-- Безопаснее V166: не трогаем группы с несколькими действующими допусками.
-- Идемпотентно: повторный запуск ничего не меняет.
--
-- Диагностика (до/после):
--   SELECT employee_id, type_id, COUNT(*) AS cnt,
--          COUNT(*) FILTER (WHERE expiry_date < CURRENT_DATE) AS expired_cnt,
--          COUNT(*) FILTER (WHERE expiry_date IS NULL OR expiry_date >= CURRENT_DATE) AS valid_cnt
--   FROM employee_permits WHERE is_active = true
--   GROUP BY employee_id, type_id HAVING COUNT(*) > 1 ORDER BY cnt DESC;
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE employee_permits a
SET is_active = false, updated_at = NOW()
WHERE COALESCE(a.is_active, true) = true
  AND a.expiry_date IS NOT NULL
  AND a.expiry_date < CURRENT_DATE
  AND EXISTS (
    SELECT 1 FROM employee_permits b
    WHERE b.employee_id = a.employee_id
      AND b.type_id     = a.type_id
      AND COALESCE(b.is_active, true) = true
      AND b.id <> a.id
      AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)
  );
