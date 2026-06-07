-- Rollback V178
ALTER TABLE procurement_requests
  DROP COLUMN IF EXISTS price_segment,
  DROP COLUMN IF EXISTS budget_limit;
