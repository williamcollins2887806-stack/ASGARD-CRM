-- V358 down: откат справочной активности в снапшоте рейтинга РП (D-246).

ALTER TABLE pm_analysis_rating_daily DROP COLUMN IF EXISTS activity_json;
