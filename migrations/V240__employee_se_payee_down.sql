DROP INDEX IF EXISTS idx_employees_se_payee;
DROP INDEX IF EXISTS idx_employees_is_payee;
ALTER TABLE employees DROP COLUMN IF EXISTS se_payee_id;
ALTER TABLE employees DROP COLUMN IF EXISTS is_se_payee;
