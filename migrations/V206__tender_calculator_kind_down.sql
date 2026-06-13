-- V206 down — откат calculator_kind
DROP INDEX IF EXISTS idx_tenders_calc_kind_to;
ALTER TABLE tenders DROP CONSTRAINT IF EXISTS tenders_calculator_kind_check;
ALTER TABLE tenders DROP COLUMN IF EXISTS calculator_user_id;
ALTER TABLE tenders DROP COLUMN IF EXISTS calculator_kind;
