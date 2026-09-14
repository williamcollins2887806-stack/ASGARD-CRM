-- V340: paid participation + internal analysis deadline for tender registry

ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS participation_paid BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS participation_fee NUMERIC(14, 2),
  ADD COLUMN IF NOT EXISTS analysis_deadline DATE;

COMMENT ON COLUMN tenders.participation_paid IS 'Платное участие в тендере (сбор сгорает при проигрыше)';
COMMENT ON COLUMN tenders.participation_fee IS 'Ориентировочная стоимость платного участия, ₽';
COMMENT ON COLUMN tenders.analysis_deadline IS 'Внутренний срок анализа: docs_deadline минус 3/5 раб. дней';

CREATE INDEX IF NOT EXISTS idx_tenders_analysis_deadline_open
  ON tenders (analysis_deadline)
  WHERE deleted_at IS NULL
    AND COALESCE(registry_status, 'рассмотрение') = 'рассмотрение'
    AND analysis_deadline IS NOT NULL;

-- Expand stale-notice kinds for analysis_deadline overdue emails
ALTER TABLE pm_analysis_stale_notices
  DROP CONSTRAINT IF EXISTS pm_analysis_stale_notices_notice_kind_check;

ALTER TABLE pm_analysis_stale_notices
  ADD CONSTRAINT pm_analysis_stale_notices_notice_kind_check
  CHECK (notice_kind IN ('idle_24h', 'deadline_2d', 'analysis_deadline_overdue'));

ALTER TABLE pm_analysis_stale_notices
  ALTER COLUMN review_id DROP NOT NULL;

ALTER TABLE pm_analysis_stale_notices
  ADD COLUMN IF NOT EXISTS tender_id INTEGER REFERENCES tenders(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS uq_pm_analysis_stale_tender_kind
  ON pm_analysis_stale_notices (tender_id, notice_kind)
  WHERE tender_id IS NOT NULL;

COMMENT ON TABLE pm_analysis_stale_notices IS
  'Антиспам: напоминания РП (idle 24h / docs ≤2d / analysis_deadline overdue)';
