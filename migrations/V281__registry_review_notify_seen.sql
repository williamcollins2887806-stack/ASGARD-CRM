-- Уведомление ТО о готовом анализе/отчёте + отметка «прочитано» в реестре
ALTER TABLE tender_rp_reviews
  ADD COLUMN IF NOT EXISTS to_notify_at TIMESTAMPTZ;

COMMENT ON COLUMN tender_rp_reviews.to_notify_at IS 'Когда РП закрыл анализ или финальный отчёт — для уведомления и подсветки в реестре';

CREATE TABLE IF NOT EXISTS tender_registry_review_seen (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tender_id)
);

CREATE INDEX IF NOT EXISTS idx_registry_review_seen_tender ON tender_registry_review_seen(tender_id);

UPDATE tender_rp_reviews
SET to_notify_at = analysis_finalized_at
WHERE analysis_finalized_at IS NOT NULL AND to_notify_at IS NULL;

UPDATE tender_rp_reviews
SET to_notify_at = updated_at
WHERE is_final = true AND to_notify_at IS NULL;
