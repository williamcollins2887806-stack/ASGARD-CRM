-- A4: источник данных о проигрыше + очередь неоднозначных матчей TenderGuru
ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS loss_source TEXT;

COMMENT ON COLUMN tenders.loss_source IS 'Источник данных о победителе: tenderguru, tenderguru_partial, manual, …';

CREATE TABLE IF NOT EXISTS tender_outcome_match_queue (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'confirmed', 'dismissed')),
  match_candidates JSONB NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  resolved_by_user_id INTEGER REFERENCES users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tender_outcome_queue_tender_pending
  ON tender_outcome_match_queue(tender_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_tender_outcome_queue_status
  ON tender_outcome_match_queue(status);
