-- V362: не допускать два активных назначения одного сотрудника на одну работу
-- (корневая причина дубля Минлибаева на work 354).

-- 1) Схлопнуть уже существующие дубли: оставить max(id), остальные — уехали
WITH dups AS (
  SELECT work_id, employee_id, MAX(id) AS keep_id
  FROM employee_assignments
  WHERE COALESCE(is_active, true) = true
    AND departure_date IS NULL
    AND employee_id IS NOT NULL
  GROUP BY work_id, employee_id
  HAVING COUNT(*) > 1
)
UPDATE employee_assignments ea
SET is_active = false,
    departure_date = COALESCE(ea.departure_date, CURRENT_DATE),
    departure_reason = COALESCE(ea.departure_reason, 'дубль назначения (V362)'),
    updated_at = NOW()
FROM dups d
WHERE ea.work_id = d.work_id
  AND ea.employee_id = d.employee_id
  AND ea.id <> d.keep_id
  AND COALESCE(ea.is_active, true) = true
  AND ea.departure_date IS NULL;

-- 2) Уникальность активных (без даты убытия)
CREATE UNIQUE INDEX IF NOT EXISTS uq_ea_active_employee_work
  ON employee_assignments (work_id, employee_id)
  WHERE COALESCE(is_active, true) = true
    AND departure_date IS NULL
    AND employee_id IS NOT NULL;
