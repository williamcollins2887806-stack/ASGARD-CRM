-- V460: поля аналитики проигрыша на tenders (Work Norms Superbrain A2)

ALTER TABLE tenders ADD COLUMN IF NOT EXISTS our_price_no_vat NUMERIC;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS our_price_with_vat NUMERIC;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS nmck_snapshot NUMERIC;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS winner_inn VARCHAR(12);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS winner_price_no_vat NUMERIC;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS winner_price_with_vat NUMERIC;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS loss_place SMALLINT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS participants_count SMALLINT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS loss_price_gap_pct NUMERIC(6, 2);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS loss_report JSONB;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS loss_reason_code VARCHAR(32);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS result_protocol_url TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS result_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_tenders_loss_place_lost
  ON tenders (loss_place)
  WHERE registry_status = 'проиграли';

CREATE INDEX IF NOT EXISTS idx_tenders_winner_inn
  ON tenders (winner_inn)
  WHERE winner_inn IS NOT NULL AND winner_inn <> '';

CREATE INDEX IF NOT EXISTS idx_tenders_loss_reason_code
  ON tenders (loss_reason_code)
  WHERE loss_reason_code IS NOT NULL AND loss_reason_code <> '';

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS idx_tenders_customer_name_trgm
      ON tenders USING gin (lower(customer_name) gin_trgm_ops);
  END IF;
END $$;
