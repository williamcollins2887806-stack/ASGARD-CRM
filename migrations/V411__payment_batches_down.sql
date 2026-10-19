-- V411 (down): откат партии счетов.
DROP INDEX IF EXISTS idx_payment_batches_status;
DROP INDEX IF EXISTS idx_payment_invoices_batch;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS batch_id;
DROP TABLE IF EXISTS payment_batches;
