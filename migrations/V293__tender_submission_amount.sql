-- V293: ensure tender submission amount columns + submitted_at for registry «подались»
ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS submission_price numeric(15,2),
  ADD COLUMN IF NOT EXISTS submission_price_with_vat numeric(15,2),
  ADD COLUMN IF NOT EXISTS tender_price_with_vat numeric(15,2),
  ADD COLUMN IF NOT EXISTS vat_pct numeric(5,2) DEFAULT 22,
  ADD COLUMN IF NOT EXISTS submitted_at timestamp without time zone;

COMMENT ON COLUMN tenders.submission_price IS 'Цена подачи без НДС';
COMMENT ON COLUMN tenders.submission_price_with_vat IS 'Цена подачи с НДС';
COMMENT ON COLUMN tenders.submitted_at IS 'Когда статус реестра стал «подались»';
