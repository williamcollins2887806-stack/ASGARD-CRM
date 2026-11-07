-- V459 down: откат колонок safe publish (данные в новых колонках теряются)

DROP INDEX IF EXISTS idx_work_norm_exp_source_work_kind;
DROP INDEX IF EXISTS idx_work_norm_exp_target_rate;

ALTER TABLE work_norm_experiences DROP CONSTRAINT IF EXISTS work_norm_experiences_source_kind_check;

ALTER TABLE work_norm_experiences
  DROP COLUMN IF EXISTS delta_pct,
  DROP COLUMN IF EXISTS norm_snapshot_json,
  DROP COLUMN IF EXISTS source_estimate_id,
  DROP COLUMN IF EXISTS source_kind,
  DROP COLUMN IF EXISTS target_rate_id;

ALTER TABLE work_norm_change_log DROP CONSTRAINT IF EXISTS work_norm_change_log_action_check;
ALTER TABLE work_norm_change_log
  ADD CONSTRAINT work_norm_change_log_action_check
  CHECK (action IN ('create', 'update', 'delete', 'import', 'confirm', 'publish', 'reject'));
