-- V258 down: откат распределённой приёмки.
DROP TABLE IF EXISTS procurement_receipts;

ALTER TABLE procurement_items
  DROP COLUMN IF EXISTS received_qty,
  DROP COLUMN IF EXISTS cancelled_at,
  DROP COLUMN IF EXISTS cancelled_reason;
