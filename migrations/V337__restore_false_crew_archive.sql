-- V337: ложный архив дружины.
-- Статус unknown («Без статуса») уже есть в CHECK с V141, но UI кидал его в архив,
-- а крон архивировал всех без ready/on_site, не глядя на недавние назначения.
-- Возвращаем в unknown тех, кто в архиве, но недавно был на объекте.

WITH candidates AS (
  SELECT e.id
  FROM employees e
  WHERE e.is_active = true
    AND e.readiness_status = 'archive'
    AND (
      EXISTS (
        SELECT 1 FROM field_checkins fc
        WHERE fc.employee_id = e.id
          AND fc.date >= CURRENT_DATE - INTERVAL '6 months'
          AND COALESCE(fc.status, '') IS DISTINCT FROM 'cancelled'
      )
      OR EXISTS (
        SELECT 1 FROM employee_assignments ea
        WHERE ea.employee_id = e.id
          AND (
            (COALESCE(ea.is_active, true) = true AND ea.departure_date IS NULL)
            OR COALESCE(ea.departure_date, ea.date_from, ea.created_at::date)
               >= CURRENT_DATE - INTERVAL '6 months'
          )
      )
    )
),
updated AS (
  UPDATE employees e
  SET readiness_status = 'unknown',
      readiness_updated_at = NOW()
  FROM candidates c
  WHERE e.id = c.id
  RETURNING e.id
)
INSERT INTO worker_readiness_log (employee_id, old_status, new_status, comment, source, created_at)
SELECT id, 'archive', 'unknown', 'V337: снят ложный архив — была недавняя работа', 'system', NOW()
FROM updated;
