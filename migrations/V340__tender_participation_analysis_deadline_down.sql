-- V340 down

DROP INDEX IF EXISTS uq_pm_analysis_stale_tender_kind;

ALTER TABLE pm_analysis_stale_notices
  DROP COLUMN IF EXISTS tender_id;

DELETE FROM pm_analysis_stale_notices WHERE review_id IS NULL;

ALTER TABLE pm_analysis_stale_notices
  ALTER COLUMN review_id SET NOT NULL;

ALTER TABLE pm_analysis_stale_notices
  DROP CONSTRAINT IF EXISTS pm_analysis_stale_notices_notice_kind_check;

ALTER TABLE pm_analysis_stale_notices
  ADD CONSTRAINT pm_analysis_stale_notices_notice_kind_check
  CHECK (notice_kind IN ('idle_24h', 'deadline_2d'));

DROP INDEX IF EXISTS idx_tenders_analysis_deadline_open;

ALTER TABLE tenders
  DROP COLUMN IF EXISTS analysis_deadline,
  DROP COLUMN IF EXISTS participation_fee,
  DROP COLUMN IF EXISTS participation_paid;
