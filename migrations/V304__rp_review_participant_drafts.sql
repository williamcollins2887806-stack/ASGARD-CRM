-- V304: параллельные черновики РП + хозяин анализа + purpose для Мимир-Quick

-- 1. Хозяин финала анализа (фиксируется при старте review; смена дежурства не отбирает)
ALTER TABLE tender_rp_reviews
  ADD COLUMN IF NOT EXISTS analysis_owner_user_id INTEGER NULL REFERENCES users(id);

UPDATE tender_rp_reviews
SET analysis_owner_user_id = COALESCE(analysis_owner_user_id, started_by_user_id, analysis_finalized_by_user_id)
WHERE analysis_owner_user_id IS NULL
  AND (started_by_user_id IS NOT NULL OR analysis_finalized_by_user_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_tender_rp_reviews_analysis_owner
  ON tender_rp_reviews(analysis_owner_user_id)
  WHERE analysis_owner_user_id IS NOT NULL;

COMMENT ON COLUMN tender_rp_reviews.analysis_owner_user_id IS
  'Хозяин финала анализа: дежурный/стартовавший; только он закрывает анализ';

-- 2. Личные черновики участников (analysis / calc)
CREATE TABLE IF NOT EXISTS tender_rp_review_participant_drafts (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES tender_rp_reviews(id) ON DELETE CASCADE,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  author_user_id INTEGER NOT NULL REFERENCES users(id),
  phase VARCHAR(20) NOT NULL CHECK (phase IN ('analysis', 'calc')),
  draft_json JSONB NOT NULL DEFAULT '{}',
  estimate_file_id INTEGER,
  report_file_id INTEGER,
  tkp_file_id INTEGER,
  mimir_session_uid TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'working'
    CHECK (status IN ('working', 'ready')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (review_id, author_user_id, phase)
);

CREATE INDEX IF NOT EXISTS idx_rp_participant_drafts_tender
  ON tender_rp_review_participant_drafts(tender_id);
CREATE INDEX IF NOT EXISTS idx_rp_participant_drafts_author
  ON tender_rp_review_participant_drafts(author_user_id)
  WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS idx_rp_participant_drafts_review_phase
  ON tender_rp_review_participant_drafts(review_id, phase);

COMMENT ON TABLE tender_rp_review_participant_drafts IS
  'Личные черновики РП по анализу/просчёту; финал для ТО — в tender_rp_reviews';

-- 3. Purpose сессии Мимир-Quick (дедуп по author+entity+purpose)
ALTER TABLE tkp_quick_sessions
  ADD COLUMN IF NOT EXISTS purpose VARCHAR(40) NOT NULL DEFAULT 'kanban';

CREATE INDEX IF NOT EXISTS idx_tkp_quick_purpose_active
  ON tkp_quick_sessions(tender_id, author_id, purpose)
  WHERE tender_id IS NOT NULL AND status NOT IN ('finalized', 'abandoned');

CREATE INDEX IF NOT EXISTS idx_tkp_quick_purpose_pt_active
  ON tkp_quick_sessions(pre_tender_id, author_id, purpose)
  WHERE pre_tender_id IS NOT NULL AND status NOT IN ('finalized', 'abandoned');

COMMENT ON COLUMN tkp_quick_sessions.purpose IS
  'kanban | rp_review_analysis | rp_review_calc — изоляция сессий разных контуров';
