-- V150: Контакты поставщика (менеджер, бухгалтер, логист и т.п.)

CREATE TABLE IF NOT EXISTS supplier_contacts (
  id          SERIAL       PRIMARY KEY,
  supplier_id INTEGER      NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  full_name   VARCHAR(255) NOT NULL,
  role        VARCHAR(100),
  phone       VARCHAR(50),
  email       VARCHAR(255),
  telegram    VARCHAR(100),
  is_primary  BOOLEAN      NOT NULL DEFAULT false,
  notes       TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_supplier_contacts_supplier ON supplier_contacts(supplier_id);
-- Не более одного primary-контакта на поставщика
CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_contacts_one_primary
  ON supplier_contacts(supplier_id) WHERE is_primary = true;
