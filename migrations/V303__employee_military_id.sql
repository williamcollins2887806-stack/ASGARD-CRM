-- V303: military_id on employees (военный билет / удостоверение)
-- Frontend employee card + staff PUT already write this field; prod lacked the column → 500.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS military_id TEXT;

COMMENT ON COLUMN employees.military_id IS 'Военный билет / удостоверение личности (серия/номер)';
