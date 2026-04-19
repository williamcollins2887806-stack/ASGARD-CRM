BEGIN;
CREATE TABLE IF NOT EXISTS assembly_orders (
  id SERIAL PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id),
  type VARCHAR(20) NOT NULL CHECK (type IN ('mobilization','demobilization','transfer')),
  status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','confirmed','packing','packed','in_transit','received','returned','closed')),
  title VARCHAR(500), object_name VARCHAR(500), destination VARCHAR(500), planned_date DATE,
  actual_sent_at TIMESTAMP, actual_received_at TIMESTAMP, source_assembly_id INTEGER REFERENCES assembly_orders(id),
  notes TEXT, created_by INTEGER NOT NULL REFERENCES users(id), confirmed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_assembly_orders_work ON assembly_orders(work_id);
CREATE INDEX idx_assembly_orders_status ON assembly_orders(status);

CREATE TABLE IF NOT EXISTS assembly_pallets (
  id SERIAL PRIMARY KEY,
  assembly_id INTEGER NOT NULL REFERENCES assembly_orders(id) ON DELETE CASCADE,
  pallet_number INTEGER NOT NULL,
  qr_uuid UUID NOT NULL DEFAULT gen_random_uuid(),
  label VARCHAR(200),
  status VARCHAR(30) DEFAULT 'open' CHECK (status IN ('open','packed','shipped','received')),
  capacity_items INTEGER,
  capacity_kg NUMERIC(10,2),
  packed_at TIMESTAMP, shipped_at TIMESTAMP, received_at TIMESTAMP,
  received_by INTEGER REFERENCES users(id), scanned_lat NUMERIC(9,6), scanned_lon NUMERIC(9,6),
  notes TEXT, created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_assembly_pallets_assembly ON assembly_pallets(assembly_id);
CREATE UNIQUE INDEX idx_assembly_pallets_qr ON assembly_pallets(qr_uuid);

CREATE TABLE IF NOT EXISTS assembly_items (
  id SERIAL PRIMARY KEY,
  assembly_id INTEGER NOT NULL REFERENCES assembly_orders(id) ON DELETE CASCADE,
  equipment_id INTEGER REFERENCES equipment(id),
  procurement_item_id INTEGER REFERENCES procurement_items(id),
  pallet_id INTEGER REFERENCES assembly_pallets(id),
  name VARCHAR(500) NOT NULL, article VARCHAR(200), unit VARCHAR(50) DEFAULT 'шт',
  quantity NUMERIC(12,3) NOT NULL DEFAULT 1,
  source VARCHAR(30) NOT NULL CHECK (source IN ('reservation','procurement_warehouse','procurement_object','manual','on_site_purchase')),
  packed BOOLEAN DEFAULT false, packed_at TIMESTAMP, packed_by INTEGER REFERENCES users(id),
  return_status VARCHAR(30) CHECK (return_status IS NULL OR return_status IN ('returning','damaged','lost','consumed')),
  return_reason TEXT, received BOOLEAN DEFAULT false, received_at TIMESTAMP, received_by INTEGER REFERENCES users(id),
  sort_order INTEGER DEFAULT 0, notes TEXT, created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_assembly_items_assembly ON assembly_items(assembly_id);
CREATE INDEX idx_assembly_items_pallet ON assembly_items(pallet_id);
CREATE INDEX idx_assembly_items_equipment ON assembly_items(equipment_id);
COMMIT;
