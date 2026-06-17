-- V218 down: убрать subcategory
DROP INDEX IF EXISTS idx_work_expenses_subcategory;
ALTER TABLE work_expenses DROP COLUMN IF EXISTS subcategory;
