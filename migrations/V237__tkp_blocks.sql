-- V237__tkp_blocks.sql
-- Wave 1, v3 канбан: блочный ТКП-конструктор
-- Каждый блок ТКП — отдельная строка (title/preamble/smeta/...), с порядком и JSON-данными

CREATE TABLE IF NOT EXISTS tkp_blocks (
  id            SERIAL PRIMARY KEY,
  tkp_id        INTEGER NOT NULL REFERENCES tkp(id) ON DELETE CASCADE,
  block_key     VARCHAR(64) NOT NULL,
    -- 'title','preamble','smeta','terms','warranty','logistics','safety','schedule','team','attach','sign'
  block_order   INTEGER NOT NULL DEFAULT 1000,
  block_title   VARCHAR(255),
  block_icon    VARCHAR(16),
  block_data    JSONB NOT NULL DEFAULT '{}',
  is_required   BOOLEAN NOT NULL DEFAULT FALSE,  -- title/sign — нельзя удалить
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Уникальность активного блока по (tkp_id, block_key) — один title на ТКП
CREATE UNIQUE INDEX IF NOT EXISTS uq_tkp_blocks_tkp_key_active
  ON tkp_blocks(tkp_id, block_key) WHERE is_active = TRUE;

-- Индекс для сортировки рендера
CREATE INDEX IF NOT EXISTS idx_tkp_blocks_tkp_order
  ON tkp_blocks(tkp_id, block_order) WHERE is_active = TRUE;

-- Расширение tkp для конструктора
ALTER TABLE tkp
  ADD COLUMN IF NOT EXISTS template_kind        VARCHAR(32),
    -- 'chemcleaning','assembly','anticor','diagnostics','vent','universal'
  ADD COLUMN IF NOT EXISTS constructor_version  INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS last_autosaved_at    TIMESTAMPTZ;
