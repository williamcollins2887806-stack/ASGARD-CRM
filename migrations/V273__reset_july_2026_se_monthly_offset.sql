-- ═══════════════════════════════════════════════════════════════════════════
-- V273: сброс «осиротевших» se_monthly_used_initial за июль 2026
--
-- Offset за месяц без подтверждённого импорта в se_monthly_history
-- давал monthly_remaining ≈ 600 ₽ вместо полного лимита 350 000 ₽.
--
-- Диагностика (до):
--   SELECT id, fio, se_monthly_used_initial
--   FROM employees
--   WHERE se_monthly_used_initial IS NOT NULL
--     AND (se_monthly_used_initial->>'year')::int = 2026
--     AND (se_monthly_used_initial->>'month')::int = 7;
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE employees
SET se_monthly_used_initial = NULL, updated_at = NOW()
WHERE se_monthly_used_initial IS NOT NULL
  AND (se_monthly_used_initial->>'year')::int = 2026
  AND (se_monthly_used_initial->>'month')::int = 7
  AND NOT EXISTS (
    SELECT 1 FROM se_monthly_history h
    WHERE h.employee_id = employees.id
      AND h.year = 2026
      AND h.month = 7
  );
