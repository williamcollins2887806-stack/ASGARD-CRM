-- V263 DOWN
BEGIN;
DROP INDEX IF EXISTS idx_work_expenses_paid_by;
ALTER TABLE work_expenses
  DROP COLUMN IF EXISTS paid_by,
  DROP COLUMN IF EXISTS paid_by_role;
COMMIT;
