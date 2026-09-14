DROP INDEX IF EXISTS idx_pii_approval;
ALTER TABLE procurement_invoice_imports
  DROP COLUMN IF EXISTS approval_status,
  DROP COLUMN IF EXISTS sent_to_pm_at,
  DROP COLUMN IF EXISTS pm_approved_at,
  DROP COLUMN IF EXISTS pm_comment,
  DROP COLUMN IF EXISTS sent_to_dir_at,
  DROP COLUMN IF EXISTS dir_approved_at,
  DROP COLUMN IF EXISTS paid_at;
