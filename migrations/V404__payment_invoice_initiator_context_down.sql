-- V404 down: откат контекста заявки.
ALTER TABLE payment_invoices
  DROP COLUMN IF EXISTS initiator_intent,
  DROP COLUMN IF EXISTS initiator_note,
  DROP COLUMN IF EXISTS contract_basis_number,
  DROP COLUMN IF EXISTS contract_basis_date,
  DROP COLUMN IF EXISTS contract_missing,
  DROP COLUMN IF EXISTS work_hint,
  DROP COLUMN IF EXISTS invoice_number,
  DROP COLUMN IF EXISTS invoice_date,
  DROP COLUMN IF EXISTS vat_amount;

DROP INDEX IF EXISTS idx_payment_invoices_contract_missing;
DROP INDEX IF EXISTS idx_payment_invoices_intent;
