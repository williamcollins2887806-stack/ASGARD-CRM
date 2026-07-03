-- DOWN миграция для V262 (spec: V258).
-- Откат remainder_destination + bulk_batch_id из se_transfers.

BEGIN;

DROP INDEX IF EXISTS idx_se_transfers_bulk;

ALTER TABLE se_transfers
  DROP CONSTRAINT IF EXISTS chk_se_remainder_destination;

ALTER TABLE se_transfers
  DROP COLUMN IF EXISTS bulk_batch_id;

ALTER TABLE se_transfers
  DROP COLUMN IF EXISTS remainder_destination;

COMMIT;
