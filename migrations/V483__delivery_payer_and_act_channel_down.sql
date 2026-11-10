-- ═══════════════════════════════════════════════════════════════════════════
-- V483 (откат): убрать признак «за чей счёт доставка» и канал акта сверки
-- ═══════════════════════════════════════════════════════════════════════════
-- ВНИМАНИЕ: удаляет данные о доставке. Перед откатом на проде сделать дамп
-- колонок, если они уже заполнены:
--   COPY (SELECT id, delivery_payer, delivery_payer_note, delivery_payer_source
--           FROM payment_invoices WHERE delivery_payer IS NOT NULL)
--     TO '/tmp/pi_delivery_backup.csv' CSV HEADER;
--
-- Идемпотентен: DROP IF EXISTS.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE payment_invoices
  DROP CONSTRAINT IF EXISTS chk_payment_invoices_delivery_payer,
  DROP CONSTRAINT IF EXISTS chk_payment_invoices_delivery_src;

ALTER TABLE payment_invoices
  DROP COLUMN IF EXISTS delivery_payer,
  DROP COLUMN IF EXISTS delivery_payer_note,
  DROP COLUMN IF EXISTS delivery_payer_source;

ALTER TABLE doc_registry
  DROP CONSTRAINT IF EXISTS chk_doc_registry_delivery_payer;

ALTER TABLE doc_registry
  DROP COLUMN IF EXISTS delivery_payer,
  DROP COLUMN IF EXISTS delivery_payer_note;

ALTER TABLE doc_reconciliation_acts
  DROP CONSTRAINT IF EXISTS chk_doc_recon_acts_receive_channel;

ALTER TABLE doc_reconciliation_acts
  DROP COLUMN IF EXISTS receive_channel;

COMMIT;

-- ПРОВЕРКА:
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_name='payment_invoices' AND column_name LIKE 'delivery_payer%';
--   -- ожидание: 0
