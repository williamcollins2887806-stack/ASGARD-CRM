-- V342: конструктор счетов и актов — позиции, реквизиты заказчика, выставление.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS customer_kpp VARCHAR(20),
  ADD COLUMN IF NOT EXISTS customer_address TEXT,
  ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);

ALTER TABLE acts
  ADD COLUMN IF NOT EXISTS items_json JSONB,
  ADD COLUMN IF NOT EXISTS customer_kpp VARCHAR(20),
  ADD COLUMN IF NOT EXISTS customer_address TEXT,
  ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(50);

COMMENT ON COLUMN invoices.items_json IS 'Позиции счёта [{name, unit, qty, price}]';
COMMENT ON COLUMN acts.items_json IS 'Позиции акта [{name, unit, qty, price}]';
