-- V463: исход тендера в эталонах Mimir (A6 — обучение на проигрышах)

ALTER TABLE mimir_reference_projects ADD COLUMN IF NOT EXISTS outcome TEXT;
ALTER TABLE mimir_reference_projects ADD COLUMN IF NOT EXISTS our_price_no_vat NUMERIC;
ALTER TABLE mimir_reference_projects ADD COLUMN IF NOT EXISTS winner_price_no_vat NUMERIC;
ALTER TABLE mimir_reference_projects ADD COLUMN IF NOT EXISTS loss_reason_code VARCHAR(32);
ALTER TABLE mimir_reference_projects ADD COLUMN IF NOT EXISTS participants_count SMALLINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'mimir_reference_projects_outcome_check'
  ) THEN
    ALTER TABLE mimir_reference_projects ADD CONSTRAINT mimir_reference_projects_outcome_check
      CHECK (outcome IS NULL OR outcome IN ('won', 'lost', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_mrp_outcome ON mimir_reference_projects (outcome)
  WHERE outcome IS NOT NULL;
