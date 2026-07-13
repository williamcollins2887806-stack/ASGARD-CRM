-- V286: согласование директора после просчёта РП (>5 млн без НДС) + обязательное ТКП
ALTER TABLE tender_rp_reviews
  ADD COLUMN IF NOT EXISTS director_review_status VARCHAR(20),
  ADD COLUMN IF NOT EXISTS director_review_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS director_review_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS director_review_comment TEXT,
  ADD COLUMN IF NOT EXISTS director_notify_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS work_price_ex_vat NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS tkp_file_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;

COMMENT ON COLUMN tender_rp_reviews.director_review_status IS 'null | pending | approved | rejected — согласование директора после просчёта';
COMMENT ON COLUMN tender_rp_reviews.work_price_ex_vat IS 'Цена работ РП без НДС на момент финализации просчёта';
COMMENT ON COLUMN tender_rp_reviews.tkp_file_id IS 'Обязательное ТКП, приложенное РП к отчёту просчёта';

CREATE INDEX IF NOT EXISTS idx_rp_reviews_director_pending
  ON tender_rp_reviews(director_review_status)
  WHERE director_review_status = 'pending';

CREATE TABLE IF NOT EXISTS tender_registry_director_seen (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, tender_id)
);

CREATE INDEX IF NOT EXISTS idx_registry_director_seen_tender ON tender_registry_director_seen(tender_id);

INSERT INTO settings (key, value_json, updated_at)
SELECT 'director_tender_threshold_rub', '5000000', NOW()
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'director_tender_threshold_rub');
