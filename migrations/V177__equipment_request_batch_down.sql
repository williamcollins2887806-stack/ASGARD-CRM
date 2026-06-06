-- Rollback V177
DROP INDEX IF EXISTS idx_eq_requests_batch;
DROP INDEX IF EXISTS idx_eq_requests_status;
ALTER TABLE equipment_requests DROP COLUMN IF EXISTS batch_id;
