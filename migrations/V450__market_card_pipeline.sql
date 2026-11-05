-- V450: конвейер карточек маркетплейса (архетипы ≤500 фото + очередь AI)
-- Откат: V450__market_card_pipeline_down.sql

CREATE TABLE IF NOT EXISTS market_card_archetypes (
  key TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  hero_photo_url TEXT,
  photo_source TEXT CHECK (photo_source IS NULL OR photo_source IN ('ai','real','placeholder')),
  prompt_hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending_photo'
    CHECK (status IN ('ready','pending_photo','failed')),
  generated_at TIMESTAMPTZ,
  cost_rub NUMERIC(12,4),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE market_card_archetypes IS 'Общие карточки витрины: одно hero-фото на группу похожих SKU';
COMMENT ON COLUMN market_card_archetypes.hero_photo_url IS 'Канон /uploads/market-cards/{key}.jpg|.svg';

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS market_card_key TEXT,
  ADD COLUMN IF NOT EXISTS photo_source TEXT;

ALTER TABLE products
  DROP CONSTRAINT IF EXISTS products_photo_source_check;
ALTER TABLE products
  ADD CONSTRAINT products_photo_source_check
  CHECK (photo_source IS NULL OR photo_source IN ('ai','real','placeholder'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_market_card_key_fkey'
  ) THEN
    ALTER TABLE products
      ADD CONSTRAINT products_market_card_key_fkey
      FOREIGN KEY (market_card_key) REFERENCES market_card_archetypes(key)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_products_market_card_key
  ON products(market_card_key) WHERE deleted_at IS NULL;

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS market_card_key TEXT,
  ADD COLUMN IF NOT EXISTS photo_source TEXT,
  ADD COLUMN IF NOT EXISTS attrs JSONB DEFAULT '{}'::jsonb;

ALTER TABLE equipment
  DROP CONSTRAINT IF EXISTS equipment_photo_source_check;
ALTER TABLE equipment
  ADD CONSTRAINT equipment_photo_source_check
  CHECK (photo_source IS NULL OR photo_source IN ('ai','real','placeholder'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'equipment_market_card_key_fkey'
  ) THEN
    ALTER TABLE equipment
      ADD CONSTRAINT equipment_market_card_key_fkey
      FOREIGN KEY (market_card_key) REFERENCES market_card_archetypes(key)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_equipment_market_card_key
  ON equipment(market_card_key);

CREATE TABLE IF NOT EXISTS market_ai_jobs (
  id BIGSERIAL PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('product','equipment','archetype')),
  entity_id INTEGER,
  archetype_key TEXT REFERENCES market_card_archetypes(key) ON UPDATE CASCADE ON DELETE CASCADE,
  job_type TEXT NOT NULL CHECK (job_type IN ('assign_key','photo','description','category_retry')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed','blocked')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_ai_jobs_target_chk CHECK (
    (entity_type = 'archetype' AND archetype_key IS NOT NULL)
    OR (entity_type IN ('product','equipment') AND entity_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_market_ai_jobs_pending
  ON market_ai_jobs(status, next_run_at)
  WHERE status IN ('pending','blocked');

CREATE INDEX IF NOT EXISTS idx_market_ai_jobs_archetype
  ON market_ai_jobs(archetype_key, job_type)
  WHERE status IN ('pending','running','blocked');

-- Settings defaults (settings PK = id, unique by key via app upsert)
INSERT INTO settings(key, value_json, updated_at)
SELECT 'market_ai_blocked_until', to_jsonb(''::text), NOW()
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'market_ai_blocked_until');

INSERT INTO settings(key, value_json, updated_at)
SELECT 'market_ai_daily_budget_rub', to_jsonb(500::numeric), NOW()
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'market_ai_daily_budget_rub');

INSERT INTO settings(key, value_json, updated_at)
SELECT 'market_ai_max_photos', to_jsonb(500::int), NOW()
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'market_ai_max_photos');
