-- V397 down: убрать ИНН/курс.
DROP INDEX IF EXISTS idx_doc_cp_inn;
DROP INDEX IF EXISTS idx_doc_cp_inn_date;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS counterparty_inn;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS fx_rate;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS fx_rate_date;
