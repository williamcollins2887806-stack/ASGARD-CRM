-- Rollback V451: payroll rubles columns (does not restore combo UI semantics)

ALTER TABLE employee_assignments DROP COLUMN IF EXISTS manual_extra_rub;
ALTER TABLE employee_assignments DROP COLUMN IF EXISTS day_rate_rub;
ALTER TABLE position_points DROP COLUMN IF EXISTS rate_rub;
