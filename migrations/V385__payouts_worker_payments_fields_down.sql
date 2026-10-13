-- V385 down: откат расширения worker_payments.
-- ВНИМАНИЕ: удаляет данные новых колонок (выплаты остаются, новые поля — нет).

DROP INDEX IF EXISTS idx_wp_confirmation_pending;
DROP INDEX IF EXISTS idx_wp_payout_period_status;
DROP INDEX IF EXISTS idx_wp_payout_batch;

ALTER TABLE worker_payments
  DROP CONSTRAINT IF EXISTS chk_wp_payout_platform,
  DROP CONSTRAINT IF EXISTS chk_wp_confirmation_status;

ALTER TABLE worker_payments
  DROP COLUMN IF EXISTS payout_platform,
  DROP COLUMN IF EXISTS payout_recipient_note,
  DROP COLUMN IF EXISTS transfer_amount,
  DROP COLUMN IF EXISTS tax_amount,
  DROP COLUMN IF EXISTS confirmation_status,
  DROP COLUMN IF EXISTS confirmation_deadline,
  DROP COLUMN IF EXISTS reminder_sent_at,
  DROP COLUMN IF EXISTS dispute_reason,
  DROP COLUMN IF EXISTS dispute_at,
  DROP COLUMN IF EXISTS payout_batch_id;
