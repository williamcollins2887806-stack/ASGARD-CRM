-- V412 (down): откат полей ставки НДС.
ALTER TABLE payment_invoices
  DROP COLUMN IF EXISTS vat_rate,
  DROP COLUMN IF EXISTS amount_net;
