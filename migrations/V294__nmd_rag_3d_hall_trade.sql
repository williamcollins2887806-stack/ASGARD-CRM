-- V294: NMD RAG for academy + 3D equip slots + hall visits + P2P trade scaffold

-- ── NMD documents for Mimir RAG ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_nmd_docs (
  id            SERIAL PRIMARY KEY,
  title         TEXT NOT NULL,
  object_tag    TEXT NOT NULL DEFAULT 'mlsp',
  original_name TEXT,
  file_path     TEXT NOT NULL,
  mime_type     TEXT,
  byte_size     INT,
  uploaded_by   INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS academy_nmd_chunks (
  id         SERIAL PRIMARY KEY,
  doc_id     INT NOT NULL REFERENCES academy_nmd_docs(id) ON DELETE CASCADE,
  chunk_idx  INT NOT NULL DEFAULT 0,
  content    TEXT NOT NULL,
  embedding  JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_nmd_chunks_doc ON academy_nmd_chunks(doc_id);
CREATE INDEX IF NOT EXISTS idx_nmd_docs_tag ON academy_nmd_docs(object_tag);

-- ── Shop: explicit equip slot + 3D asset key ────────────────────────────────
ALTER TABLE gamification_shop_items
  ADD COLUMN IF NOT EXISTS equip_slot TEXT,
  ADD COLUMN IF NOT EXISTS asset_key TEXT;

UPDATE gamification_shop_items SET equip_slot = 'helmet', asset_key = 'helmet_horned'
WHERE name ILIKE '%шлем%рогат%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'helmet', asset_key = 'helmet_steel'
WHERE name ILIKE '%шлем%сталь%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'helmet', asset_key = 'helmet_jarl'
WHERE name ILIKE '%шлем%ярл%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'helmet', asset_key = 'helmet_berserk'
WHERE name ILIKE '%шлем%берсерк%' OR name ILIKE '%маска%берсерк%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'weapon', asset_key = 'weapon_axe'
WHERE name ILIKE '%топор%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'weapon', asset_key = 'weapon_hammer'
WHERE name ILIKE '%молот%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'weapon', asset_key = 'weapon_spear'
WHERE (name ILIKE '%копь%' OR name ILIKE '%гунгнир%') AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'weapon', asset_key = 'weapon_sword'
WHERE name ILIKE '%меч%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'armor', asset_key = 'armor_chain'
WHERE name ILIKE '%кольчуг%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'armor', asset_key = 'armor_jarl'
WHERE name ILIKE '%нагрудник%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'cape', asset_key = 'cape_bear'
WHERE name ILIKE '%медвеж%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'cape', asset_key = 'cape_wolf'
WHERE name ILIKE '%волч%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'avatar', asset_key = 'body_odin'
WHERE name ILIKE '%аватар%один%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'avatar', asset_key = 'body_thor'
WHERE name ILIKE '%аватар%тор%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'avatar', asset_key = 'body_warrior'
WHERE name ILIKE '%аватар%воин%' AND equip_slot IS NULL;
UPDATE gamification_shop_items SET equip_slot = 'avatar', asset_key = 'body_berserk'
WHERE name ILIKE '%аватар%берсерк%' AND equip_slot IS NULL;

-- Store asset keys on employee for 3D rendering (keep name columns for display)
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS asset_helmet TEXT,
  ADD COLUMN IF NOT EXISTS asset_weapon TEXT,
  ADD COLUMN IF NOT EXISTS asset_armor TEXT,
  ADD COLUMN IF NOT EXISTS asset_cape TEXT,
  ADD COLUMN IF NOT EXISTS asset_boots TEXT,
  ADD COLUMN IF NOT EXISTS asset_face_paint TEXT,
  ADD COLUMN IF NOT EXISTS asset_body TEXT;

-- ── Hall visits / praise ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS field_hall_visits (
  id              SERIAL PRIMARY KEY,
  visitor_id      INT NOT NULL REFERENCES employees(id),
  host_id         INT NOT NULL REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hall_visits_host ON field_hall_visits(host_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_hall_visits_visitor ON field_hall_visits(visitor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS field_hall_praise (
  id          SERIAL PRIMARY KEY,
  from_id     INT NOT NULL REFERENCES employees(id),
  to_id       INT NOT NULL REFERENCES employees(id),
  praise_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_hall_praise_daily ON field_hall_praise(from_id, to_id, praise_date);

-- ── P2P trade scaffold ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS gamification_trade_offers (
  id              SERIAL PRIMARY KEY,
  from_employee_id INT NOT NULL REFERENCES employees(id),
  to_employee_id   INT NOT NULL REFERENCES employees(id),
  from_inventory_id INT REFERENCES gamification_inventory(id),
  to_inventory_id   INT REFERENCES gamification_inventory(id),
  price_runes       INT NOT NULL DEFAULT 0,
  escrow_runes      INT NOT NULL DEFAULT 0,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','accepted','cancelled','expired','completed')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at       TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trade_from ON gamification_trade_offers(from_employee_id, status);
CREATE INDEX IF NOT EXISTS idx_trade_to ON gamification_trade_offers(to_employee_id, status);
