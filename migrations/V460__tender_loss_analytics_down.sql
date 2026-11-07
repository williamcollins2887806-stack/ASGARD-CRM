-- V460 down: снимаем только то, что добавила миграция (колонки могли быть заполнены).

DROP INDEX IF EXISTS idx_tenders_customer_name_trgm;
DROP INDEX IF EXISTS idx_tenders_loss_reason_code;
DROP INDEX IF EXISTS idx_tenders_winner_inn;
DROP INDEX IF EXISTS idx_tenders_loss_place_lost;

ALTER TABLE tenders DROP COLUMN IF EXISTS result_at;
ALTER TABLE tenders DROP COLUMN IF EXISTS result_protocol_url;
ALTER TABLE tenders DROP COLUMN IF EXISTS loss_reason_code;
ALTER TABLE tenders DROP COLUMN IF EXISTS loss_report;
ALTER TABLE tenders DROP COLUMN IF EXISTS loss_price_gap_pct;
ALTER TABLE tenders DROP COLUMN IF EXISTS participants_count;
ALTER TABLE tenders DROP COLUMN IF EXISTS loss_place;
ALTER TABLE tenders DROP COLUMN IF EXISTS winner_price_with_vat;
ALTER TABLE tenders DROP COLUMN IF EXISTS winner_price_no_vat;
ALTER TABLE tenders DROP COLUMN IF EXISTS winner_inn;
ALTER TABLE tenders DROP COLUMN IF EXISTS nmck_snapshot;
ALTER TABLE tenders DROP COLUMN IF EXISTS our_price_with_vat;
ALTER TABLE tenders DROP COLUMN IF EXISTS our_price_no_vat;
