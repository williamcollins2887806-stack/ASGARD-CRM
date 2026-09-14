-- V330: Рейтинг эффективности анализа РП — started_at + суточные снапшоты

ALTER TABLE tender_rp_reviews
  ADD COLUMN IF NOT EXISTS analysis_started_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN tender_rp_reviews.analysis_started_at IS
  'Первый осмысленный старт анализа (первый save_draft / активность)';

CREATE INDEX IF NOT EXISTS idx_tender_rp_reviews_analysis_started
  ON tender_rp_reviews(analysis_started_at)
  WHERE analysis_started_at IS NOT NULL;

-- Backfill from first save_draft / finalize in log, else review.created_at when started
UPDATE tender_rp_reviews rev
SET analysis_started_at = COALESCE(
  (
    SELECT MIN(l.created_at)
    FROM tender_rp_review_log l
    WHERE l.review_id = rev.id
      AND l.action IN ('save_draft', 'finalize_analysis', 'finalize_reject', 'finalize')
  ),
  CASE
    WHEN rev.started_by_user_id IS NOT NULL OR rev.analysis_owner_user_id IS NOT NULL
      THEN rev.created_at
    ELSE NULL
  END
)
WHERE analysis_started_at IS NULL;

CREATE TABLE IF NOT EXISTS pm_analysis_rating_daily (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  as_of_date DATE NOT NULL,
  window_kind VARCHAR(10) NOT NULL
    CHECK (window_kind IN ('duty', 'd30', 'd90')),
  score INTEGER NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  grade VARCHAR(1) NOT NULL DEFAULT 'E' CHECK (grade IN ('A', 'B', 'C', 'D', 'E')),
  period_start DATE,
  period_end DATE,
  components_json JSONB NOT NULL DEFAULT '{}',
  penalties_json JSONB NOT NULL DEFAULT '{}',
  bonuses_json JSONB NOT NULL DEFAULT '{}',
  recs_json JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, as_of_date, window_kind)
);

CREATE INDEX IF NOT EXISTS idx_pm_analysis_rating_daily_asof
  ON pm_analysis_rating_daily(as_of_date DESC, window_kind);

CREATE INDEX IF NOT EXISTS idx_pm_analysis_rating_daily_score
  ON pm_analysis_rating_daily(window_kind, as_of_date DESC, score DESC);

COMMENT ON TABLE pm_analysis_rating_daily IS
  'Суточный снапшот рейтинга эффективности РП по анализу тендеров';
