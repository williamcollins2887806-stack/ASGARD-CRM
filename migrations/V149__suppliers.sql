-- V149: Справочник поставщиков (закупки 2.0)
-- Поставщики материалов, аренды техники, услуг. supplier на procurement_items
-- остаётся строкой для совместимости; здесь — структурированный справочник.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS suppliers (
  id          SERIAL        PRIMARY KEY,
  name        VARCHAR(500)  NOT NULL,
  inn         VARCHAR(12),
  kpp         VARCHAR(9),
  ogrn        VARCHAR(15),
  phone       VARCHAR(50),
  email       VARCHAR(255),
  website     VARCHAR(500),
  address     TEXT,
  category    VARCHAR(20)   NOT NULL DEFAULT 'materials'
                CHECK (category IN ('materials','equipment_rental','services','other')),
  rating      SMALLINT      CHECK (rating BETWEEN 1 AND 5),
  notes       TEXT,
  is_active   BOOLEAN       NOT NULL DEFAULT true,
  created_by  INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  deleted_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_suppliers_category  ON suppliers(category)  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_active    ON suppliers(is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_inn       ON suppliers(inn)        WHERE inn IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_suppliers_name_trgm ON suppliers USING gin(name gin_trgm_ops);
