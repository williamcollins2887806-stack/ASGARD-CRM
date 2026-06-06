-- V158: Адресное хранение склада (зоны / стеллажи / полки / ячейки).
-- Каждая ячейка имеет QR — при скане система говорит «положи в A-12» (раскладка как Ozon/WB).
-- kind: storage (хранение), staging (зона приёмки/отгрузки), quarantine (брак/разбор).

CREATE TABLE IF NOT EXISTS warehouse_locations (
  id           SERIAL       PRIMARY KEY,
  warehouse_id INTEGER      NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  zone         VARCHAR(50)  NOT NULL DEFAULT 'A',
  rack         VARCHAR(50),
  shelf        VARCHAR(50),
  cell         VARCHAR(50),
  label        VARCHAR(200),
  qr_uuid      UUID         NOT NULL DEFAULT gen_random_uuid(),
  kind         VARCHAR(20)  NOT NULL DEFAULT 'storage'
                 CHECK (kind IN ('storage','staging','quarantine')),
  capacity     NUMERIC(14,3),
  is_active    BOOLEAN      NOT NULL DEFAULT true,
  created_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  deleted_at   TIMESTAMPTZ,
  CONSTRAINT uq_wh_location UNIQUE (warehouse_id, zone, rack, shelf, cell)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wh_loc_qr     ON warehouse_locations(qr_uuid);
CREATE INDEX IF NOT EXISTS        idx_wh_loc_wh     ON warehouse_locations(warehouse_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS        idx_wh_loc_active ON warehouse_locations(warehouse_id, is_active) WHERE deleted_at IS NULL;
