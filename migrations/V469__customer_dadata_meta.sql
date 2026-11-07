-- V469: метаданные сверки контрагентов с DaData + статус для реестра
-- Карта контрагентов: ok / not_found / liquidated / unchecked / quarantine

CREATE TABLE IF NOT EXISTS customer_dadata_meta (
  inn            VARCHAR(12) PRIMARY KEY,
  status         TEXT NOT NULL DEFAULT 'unchecked'
                   CHECK (status IN ('ok','not_found','liquidated','unchecked','quarantine')),
  raw_state      TEXT,
  checked_at     TIMESTAMPTZ,
  source         TEXT DEFAULT 'dadata',
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_dadata_meta_status
  ON customer_dadata_meta (status);

COMMENT ON TABLE customer_dadata_meta IS
  'Статус сверки ИНН с ЕГРЮЛ/DaData для Карты контрагентов';
