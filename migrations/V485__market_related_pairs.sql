-- V485: пары «С этим обычно берут» / «Похожие» для карточек маркетплейса
-- Откат: V485__market_related_pairs_down.sql

CREATE TABLE IF NOT EXISTS market_related_pairs (
  id BIGSERIAL PRIMARY KEY,
  seed_key TEXT NOT NULL,
  related_key TEXT NOT NULL,
  relation TEXT NOT NULL CHECK (relation IN ('complementary', 'similar')),
  score DOUBLE PRECISION NOT NULL DEFAULT 0,
  evidence_count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_related_pairs_uniq UNIQUE (seed_key, related_key, relation)
);

CREATE INDEX IF NOT EXISTS idx_market_related_seed
  ON market_related_pairs (seed_key, relation, score DESC);

COMMENT ON TABLE market_related_pairs IS 'Кандидаты related для карточки склада: complementary (корзина/выдача) и similar (контент)';
COMMENT ON COLUMN market_related_pairs.seed_key IS 'Ключ карточки: market_card_key | product:ID | eqcard:name|brand|model';
COMMENT ON COLUMN market_related_pairs.related_key IS 'Ключ рекомендуемой карточки в том же формате';
