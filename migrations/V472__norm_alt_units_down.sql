-- Откат V472.
DROP TABLE IF EXISTS work_norm_unit_conversions;
DROP TABLE IF EXISTS work_norm_layer_defaults;
DROP INDEX IF EXISTS idx_work_norm_rates_confidence;
ALTER TABLE work_norm_rates DROP COLUMN IF EXISTS confidence;
ALTER TABLE work_norm_rates DROP COLUMN IF EXISTS applicability;
