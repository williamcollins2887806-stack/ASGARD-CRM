-- V332: anti-spam log for stale analysis email reminders

CREATE TABLE IF NOT EXISTS pm_analysis_stale_notices (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES tender_rp_reviews(id) ON DELETE CASCADE,
  notice_kind VARCHAR(32) NOT NULL
    CHECK (notice_kind IN ('idle_24h', 'deadline_2d')),
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (review_id, notice_kind)
);

CREATE INDEX IF NOT EXISTS idx_pm_analysis_stale_notices_sent
  ON pm_analysis_stale_notices(sent_at DESC);

COMMENT ON TABLE pm_analysis_stale_notices IS
  'Антиспам: напоминания РП о незакрытом анализе (idle 24h / deadline ≤2d)';
