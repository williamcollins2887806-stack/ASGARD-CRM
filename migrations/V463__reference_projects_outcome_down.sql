DROP INDEX IF EXISTS idx_mrp_outcome;
ALTER TABLE mimir_reference_projects DROP CONSTRAINT IF EXISTS mimir_reference_projects_outcome_check;
ALTER TABLE mimir_reference_projects DROP COLUMN IF EXISTS participants_count;
ALTER TABLE mimir_reference_projects DROP COLUMN IF EXISTS loss_reason_code;
ALTER TABLE mimir_reference_projects DROP COLUMN IF EXISTS winner_price_no_vat;
ALTER TABLE mimir_reference_projects DROP COLUMN IF EXISTS our_price_no_vat;
ALTER TABLE mimir_reference_projects DROP COLUMN IF EXISTS outcome;
