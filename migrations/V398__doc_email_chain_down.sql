-- V398 down: убрать поля email-цепочки и таблицы intake.
DROP INDEX IF EXISTS idx_intake_thread;
DROP INDEX IF EXISTS idx_intake_doc;
DROP INDEX IF EXISTS uq_intake_email_attachment;
DROP TABLE IF EXISTS email_threads;
DROP TABLE IF EXISTS doc_email_intake;
DROP INDEX IF EXISTS idx_pi_awaiting_expires;
DROP INDEX IF EXISTS uq_pi_source_attachment;
ALTER TABLE payment_invoices DROP CONSTRAINT IF EXISTS chk_pi_status_v398;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS approval_expires_at;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS archived_at;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS source_email_id;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS source_attachment_id;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS source_thread_key;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS external_approver_email;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS approval_channel;
-- Настройки Части II не удаляем (безвредны, нужны при повторном включении).
