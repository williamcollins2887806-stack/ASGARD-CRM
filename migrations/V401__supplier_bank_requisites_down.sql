-- V401 down: убрать банковские реквизиты.
ALTER TABLE suppliers DROP COLUMN IF EXISTS bik;
ALTER TABLE suppliers DROP COLUMN IF EXISTS bank_name;
ALTER TABLE suppliers DROP COLUMN IF EXISTS rs;
ALTER TABLE suppliers DROP COLUMN IF EXISTS ks;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS pp_number;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS pp_date;
ALTER TABLE payment_invoices DROP COLUMN IF EXISTS payee_requisites;
