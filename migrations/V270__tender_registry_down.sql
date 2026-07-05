DROP TABLE IF EXISTS tenderguru_candidates;
DROP TABLE IF EXISTS tender_rp_review_collaborators;
DROP TABLE IF EXISTS tender_rp_review_log;
DROP TABLE IF EXISTS tender_rp_reviews;
DROP TABLE IF EXISTS pm_duty_roster;
ALTER TABLE tenders DROP CONSTRAINT IF EXISTS tenders_registry_status_check;
ALTER TABLE tenders DROP COLUMN IF EXISTS registry_status;
