-- V346: WMS map objects, location link, op sessions, inventory, cart→assembly link
BEGIN;

-- Map objects (1 unit = 1 meter)
CREATE TABLE IF NOT EXISTS warehouse_map_floors (
  id           SERIAL PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  name         VARCHAR(200) NOT NULL DEFAULT 'Основной',
  width_m      NUMERIC(10,3) NOT NULL DEFAULT 28,
  depth_m      NUMERIC(10,3) NOT NULL DEFAULT 15,
  height_m     NUMERIC(10,3) NOT NULL DEFAULT 5.5,
  origin_x     NUMERIC(10,3) NOT NULL DEFAULT 0,
  origin_z     NUMERIC(10,3) NOT NULL DEFAULT 0,
  rooms_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  meta_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (warehouse_id, name)
);

CREATE TABLE IF NOT EXISTS warehouse_map_objects (
  id            SERIAL PRIMARY KEY,
  floor_id      INTEGER NOT NULL REFERENCES warehouse_map_floors(id) ON DELETE CASCADE,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  object_type   VARCHAR(40) NOT NULL
    CHECK (object_type IN (
      'shelf_light','shelf_pallet','clothing','floor_zone',
      'scrap','workbench','machine','assembly_pallet'
    )),
  code          VARCHAR(40),
  label         VARCHAR(200),
  x_m           NUMERIC(10,3) NOT NULL DEFAULT 0,
  z_m           NUMERIC(10,3) NOT NULL DEFAULT 0,
  rot_deg       NUMERIC(8,2) NOT NULL DEFAULT 0,
  width_m       NUMERIC(10,3) NOT NULL DEFAULT 2.7,
  depth_m       NUMERIC(10,3) NOT NULL DEFAULT 0.95,
  height_m      NUMERIC(10,3) NOT NULL DEFAULT 2.4,
  params_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  category_tags TEXT[] NOT NULL DEFAULT '{}',
  load_kg       NUMERIC(12,2),
  assembly_id   INTEGER REFERENCES assembly_orders(id) ON DELETE SET NULL,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wh_map_obj_floor ON warehouse_map_objects(floor_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wh_map_obj_wh ON warehouse_map_objects(warehouse_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wh_map_obj_type ON warehouse_map_objects(object_type) WHERE deleted_at IS NULL;

-- Link locations to map object cell
ALTER TABLE warehouse_locations
  ADD COLUMN IF NOT EXISTS map_object_id INTEGER REFERENCES warehouse_map_objects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shelf_idx INTEGER,
  ADD COLUMN IF NOT EXISTS place_idx INTEGER,
  ADD COLUMN IF NOT EXISTS place_code VARCHAR(40);

CREATE INDEX IF NOT EXISTS idx_wh_loc_map_obj ON warehouse_locations(map_object_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_wh_loc_place_code ON warehouse_locations(warehouse_id, place_code) WHERE deleted_at IS NULL;

-- Op sessions (receive/putaway/pick/inventory/unpick)
CREATE TABLE IF NOT EXISTS warehouse_op_sessions (
  id            SERIAL PRIMARY KEY,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  session_type  VARCHAR(20) NOT NULL
    CHECK (session_type IN ('receive','putaway','pick','inventory','unpick')),
  status        VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','paused','closed','cancelled')),
  title         VARCHAR(300),
  assembly_id   INTEGER REFERENCES assembly_orders(id) ON DELETE SET NULL,
  document_ref  VARCHAR(300),
  meta_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  opened_by     INTEGER NOT NULL REFERENCES users(id),
  closed_by     INTEGER REFERENCES users(id),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ,
  device        VARCHAR(20) DEFAULT 'crm'
);

CREATE INDEX IF NOT EXISTS idx_wh_op_sess_wh ON warehouse_op_sessions(warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_wh_op_sess_asm ON warehouse_op_sessions(assembly_id) WHERE assembly_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS warehouse_op_session_items (
  id              SERIAL PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES warehouse_op_sessions(id) ON DELETE CASCADE,
  line_no         INTEGER NOT NULL DEFAULT 1,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','locked','done','skipped','variance')),
  track_type      VARCHAR(20) NOT NULL DEFAULT 'consumable'
    CHECK (track_type IN ('piece','consumable')),
  product_id      INTEGER REFERENCES products(id) ON DELETE SET NULL,
  equipment_id    INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
  assembly_item_id INTEGER REFERENCES assembly_items(id) ON DELETE SET NULL,
  location_id     INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  target_location_id INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  planned_qty     NUMERIC(14,3),
  fact_qty        NUMERIC(14,3),
  unit            VARCHAR(40) DEFAULT 'шт',
  reason_code     VARCHAR(40),
  notes           TEXT,
  locked_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  locked_at       TIMESTAMPTZ,
  lock_version    INTEGER NOT NULL DEFAULT 0,
  done_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at         TIMESTAMPTZ,
  device          VARCHAR(20),
  meta_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wh_op_item_sess ON warehouse_op_session_items(session_id, status);
CREATE INDEX IF NOT EXISTS idx_wh_op_item_lock ON warehouse_op_session_items(locked_by) WHERE status = 'locked';

-- Inventory sessions (semi-annual)
CREATE TABLE IF NOT EXISTS warehouse_inventory_sessions (
  id            SERIAL PRIMARY KEY,
  warehouse_id  INTEGER NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  status        VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','review','closed','cancelled')),
  scope_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  title         VARCHAR(300),
  opened_by     INTEGER NOT NULL REFERENCES users(id),
  closed_by     INTEGER REFERENCES users(id),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at     TIMESTAMPTZ,
  notes         TEXT
);

CREATE TABLE IF NOT EXISTS warehouse_inventory_lines (
  id              SERIAL PRIMARY KEY,
  session_id      INTEGER NOT NULL REFERENCES warehouse_inventory_sessions(id) ON DELETE CASCADE,
  location_id     INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  map_object_id   INTEGER REFERENCES warehouse_map_objects(id) ON DELETE SET NULL,
  track_type      VARCHAR(20) NOT NULL CHECK (track_type IN ('piece','consumable')),
  product_id      INTEGER REFERENCES products(id) ON DELETE SET NULL,
  equipment_id    INTEGER REFERENCES equipment(id) ON DELETE SET NULL,
  expected_qty    NUMERIC(14,3),
  fact_qty        NUMERIC(14,3),
  variance_qty    NUMERIC(14,3),
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','matched','surplus','shortage','missing','resolved')),
  reason_code     VARCHAR(40),
  resolved_by     INTEGER REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  notes           TEXT,
  scanned_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wh_inv_line_sess ON warehouse_inventory_lines(session_id);

-- Cart → assembly link + change-order unpick tracking
ALTER TABLE assembly_orders
  ADD COLUMN IF NOT EXISTS source_cart_id INTEGER,
  ADD COLUMN IF NOT EXISTS auto_from_cart BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE assembly_items
  ADD COLUMN IF NOT EXISTS cart_item_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS line_status VARCHAR(40) DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS unpick_to_location_id INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL;

DO $$
BEGIN
  BEGIN
    ALTER TABLE assembly_items ADD CONSTRAINT assembly_items_line_status_check
      CHECK (line_status IS NULL OR line_status IN (
        'pending','reserved','awaiting_procurement','awaiting_wh_approve',
        'on_pallet','unpick_requested','removed','cancelled'
      ));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Expand assembly_items.source if constrained tightly (safe additive via drop/recheck when needed)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name='assembly_items' AND constraint_name LIKE '%source%'
  ) THEN
    BEGIN
      ALTER TABLE assembly_items DROP CONSTRAINT IF EXISTS assembly_items_source_check;
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END IF;
  BEGIN
    ALTER TABLE assembly_items ADD CONSTRAINT assembly_items_source_check
      CHECK (source IN (
        'reservation','procurement_warehouse','procurement_object','manual',
        'on_site_purchase','from_warehouse','from_cart','change_order'
      ));
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- products barcode helper index (only if column exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='products' AND column_name='barcode'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL AND barcode <> '';
  END IF;
END $$;

-- Seed floor for first warehouse (if any)
INSERT INTO warehouse_map_floors (warehouse_id, name, width_m, depth_m, height_m, rooms_json, meta_json)
SELECT w.id, 'Основной', 28, 15, 5.5,
  '[
    {"id":"general","label":"Общее пространство","x":0,"z":0,"w":18,"d":12},
    {"id":"locksmith","label":"Слесарка","x":-12,"z":4,"w":5,"d":4},
    {"id":"weld","label":"Сварочная","x":-12,"z":-2,"w":5,"d":4},
    {"id":"kitchen","label":"Кухня","x":10,"z":5,"w":4,"d":3}
  ]'::jsonb,
  '{"entrance":"south","door_x":0,"door_z":7.3,"aisle_x":[-6,-2,2],"aisle_z":[-4,0,4]}'::jsonb
FROM warehouses w
ORDER BY w.id
LIMIT 1
ON CONFLICT (warehouse_id, name) DO NOTHING;

-- Demo objects (only if floor exists and no objects yet)
INSERT INTO warehouse_map_objects (floor_id, warehouse_id, object_type, code, label, x_m, z_m, rot_deg, width_m, depth_m, height_m, params_json, category_tags, load_kg)
SELECT f.id, f.warehouse_id, v.object_type, v.code, v.label, v.x_m, v.z_m, v.rot_deg, v.width_m, v.depth_m, v.height_m, v.params_json::jsonb, v.tags, v.load_kg
FROM warehouse_map_floors f
CROSS JOIN (VALUES
  ('shelf_light','R1','Стеллаж лёгкий 1',-8.0,-5.0,0,2.4,0.8,2.2,'{"shelf_count":5,"places_per_shelf":2,"shelf_pitch_m":0.4}',ARRAY['consumable'],800::numeric),
  ('shelf_light','R2','Стеллаж лёгкий 2',-5.0,-5.0,0,3.0,0.9,2.6,'{"shelf_count":6,"places_per_shelf":3,"shelf_pitch_m":0.4}',ARRAY['consumable','fastener'],900),
  ('shelf_pallet','P1','Паллетный 1',-1.5,-5.2,0,2.8,1.2,3.5,'{"pallet_levels":3,"slots_per_level":2}',ARRAY['heavy'],2000),
  ('clothing','C1','Одежда / СИЗ',-8.0,-1.0,0,3.5,0.7,2.1,'{"clothing_sections":6}',ARRAY['ppe','clothing'],200),
  ('floor_zone','F1','Пол >500 кг',2.5,-4.5,0,4.0,3.0,0.05,'{"zone_kind":"heavy_floor","min_kg":500}',ARRAY['heavy'],5000),
  ('scrap','S1','Металлолом',-11.5,5.5,0,2.0,1.5,1.2,'{"bin":true}',ARRAY['scrap'],1500),
  ('workbench','W1','Стол кладовщика',0.0,6.5,0,1.8,0.8,0.9,'{"role":"desk"}',ARRAY['ops'],100),
  ('machine','M1','Пескоструй',6.0,6.2,0,2.2,1.4,2.0,'{"machine":"sandblaster"}',ARRAY['machine'],800),
  ('assembly_pallet','AP1','Паллет сбора',8.0,-2.0,0,1.2,1.0,0.3,'{"status":"open"}',ARRAY['assembly'],800)
) AS v(object_type, code, label, x_m, z_m, rot_deg, width_m, depth_m, height_m, params_json, tags, load_kg)
WHERE NOT EXISTS (SELECT 1 FROM warehouse_map_objects o WHERE o.floor_id = f.id AND o.deleted_at IS NULL)
LIMIT 9;

COMMIT;
