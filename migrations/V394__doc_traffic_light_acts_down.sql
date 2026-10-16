-- ============================================================================
-- V394 down: откат светофора/корректировок/актов/календаря.
-- ВНИМАНИЕ: применяется только при ПОЛНОМ откате фичи (флаг выключен и данные
-- не нужны). Удаляет данные новых таблиц. Колонки doc_registry дропаются —
-- это разрушительно, поэтому только вручную, не автоматическим раннером.
-- ============================================================================

BEGIN;

DROP INDEX IF EXISTS idx_doc_payment_due_open;
DROP INDEX IF EXISTS idx_doc_sf_due_open;
DROP INDEX IF EXISTS idx_doc_correction_open;
DROP INDEX IF EXISTS idx_doc_recon_due_open;

DROP TABLE IF EXISTS doc_reminder_log;
DROP TABLE IF EXISTS doc_reconciliation_acts;
DROP TABLE IF EXISTS work_calendar;

ALTER TABLE doc_registry DROP CONSTRAINT IF EXISTS chk_doc_payment_kind;
ALTER TABLE doc_registry DROP CONSTRAINT IF EXISTS chk_doc_sf_basis;
ALTER TABLE doc_registry DROP CONSTRAINT IF EXISTS chk_doc_correction_state;
ALTER TABLE doc_registry DROP CONSTRAINT IF EXISTS chk_doc_correction_kind;

ALTER TABLE doc_registry DROP COLUMN IF EXISTS payment_kind;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS payment_schedule;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS sf_basis;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS service_done_at;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS no_payment_terms;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS correction_state;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS correction_kind;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS correction_comment;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS correction_by;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS correction_at;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS sf_requested_at;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS sf_received_at;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS recon_requested_at;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS recon_received_at;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS recon_due_at;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS currency;
ALTER TABLE doc_registry DROP COLUMN IF EXISTS amount_currency;

-- Настройки фичи не удаляем: они безвредны и нужны при повторном включении.

COMMIT;
