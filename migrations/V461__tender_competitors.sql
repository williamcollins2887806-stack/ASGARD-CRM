-- V461: участники закупки по итогам протокола (A2)

CREATE TABLE IF NOT EXISTS tender_competitors (
  id              BIGSERIAL PRIMARY KEY,
  tender_id       INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  place           SMALLINT NOT NULL,
  company_name    TEXT,
  company_inn     VARCHAR(12),
  price_no_vat    NUMERIC,
  price_with_vat  NUMERIC,
  is_winner       BOOLEAN NOT NULL DEFAULT false,
  source          VARCHAR(32) DEFAULT 'manual',
  protocol_url    TEXT,
  raw_json        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tender_id, place)
);

CREATE INDEX IF NOT EXISTS idx_tender_competitors_tender_id ON tender_competitors (tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_competitors_inn ON tender_competitors (company_inn)
  WHERE company_inn IS NOT NULL AND company_inn <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_competitors_one_winner
  ON tender_competitors (tender_id)
  WHERE is_winner = true;
