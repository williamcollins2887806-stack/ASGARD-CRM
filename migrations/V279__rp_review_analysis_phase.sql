-- V279: двухфазный отчёт РП — закрытие анализа отдельно от финального просчёта

ALTER TABLE tender_rp_reviews
  ADD COLUMN IF NOT EXISTS analysis_finalized_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS analysis_finalized_by_user_id INTEGER NULL REFERENCES users(id);

CREATE INDEX IF NOT EXISTS idx_tender_rp_reviews_analysis_finalized
  ON tender_rp_reviews(analysis_finalized_at)
  WHERE analysis_finalized_at IS NOT NULL;

COMMENT ON COLUMN tender_rp_reviews.analysis_finalized_at IS 'Когда дежурный РП закрыл быстрый анализ (до полного просчёта)';
COMMENT ON COLUMN tender_rp_reviews.analysis_finalized_by_user_id IS 'Кто закрыл анализ';
