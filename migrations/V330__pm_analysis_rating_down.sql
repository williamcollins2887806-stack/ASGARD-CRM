-- V330 down: рейтинг анализа РП

DROP TABLE IF EXISTS pm_analysis_rating_daily;
DROP INDEX IF EXISTS idx_tender_rp_reviews_analysis_started;
ALTER TABLE tender_rp_reviews DROP COLUMN IF EXISTS analysis_started_at;
