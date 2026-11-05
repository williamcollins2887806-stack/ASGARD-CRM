-- V468 down: откат поэтапного анализа Мимира.

DROP INDEX IF EXISTS idx_tkp_quick_stage;

ALTER TABLE tkp_quick_sessions DROP CONSTRAINT IF EXISTS tkp_quick_sessions_stage_check;
ALTER TABLE tkp_quick_sessions
  DROP COLUMN IF EXISTS stage_updated_at,
  DROP COLUMN IF EXISTS stage_version,
  DROP COLUMN IF EXISTS stage_state,
  DROP COLUMN IF EXISTS stage;
