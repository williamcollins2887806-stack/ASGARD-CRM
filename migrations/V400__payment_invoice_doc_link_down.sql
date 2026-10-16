-- V400 down: убрать страховку от дубля заявок.
DROP INDEX IF EXISTS uq_pi_doc_registry;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS doc_registry_id;
