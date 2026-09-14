-- V348: Согласование по счетам (волны), не только по всей заявке.
-- Закупщик может грузить 1..N счетов и отправлять каждый на РП → оплату
-- не дожидаясь остальных позиций.

ALTER TABLE procurement_invoice_imports
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR(32) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS sent_to_pm_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pm_approved_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pm_comment      TEXT,
  ADD COLUMN IF NOT EXISTS sent_to_dir_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dir_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_at         TIMESTAMPTZ;

-- draft | awaiting_pm | pm_approved | pm_returned | awaiting_dir | dir_approved | paid
COMMENT ON COLUMN procurement_invoice_imports.approval_status IS
  'Волна согласования счёта: draft→awaiting_pm→pm_approved→awaiting_dir→dir_approved→paid (или pm_returned)';

CREATE INDEX IF NOT EXISTS idx_pii_approval
  ON procurement_invoice_imports(procurement_id, approval_status);
