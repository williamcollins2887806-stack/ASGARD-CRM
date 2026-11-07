-- V459: безопасная публикация норм — привязка опыта к rate, revert в audit, source_kind

ALTER TABLE work_norm_experiences
  ADD COLUMN IF NOT EXISTS target_rate_id BIGINT REFERENCES work_norm_rates(id),
  ADD COLUMN IF NOT EXISTS source_kind TEXT DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_estimate_id INT,
  ADD COLUMN IF NOT EXISTS norm_snapshot_json JSONB,
  ADD COLUMN IF NOT EXISTS delta_pct NUMERIC;

ALTER TABLE work_norm_experiences DROP CONSTRAINT IF EXISTS work_norm_experiences_source_kind_check;
ALTER TABLE work_norm_experiences
  ADD CONSTRAINT work_norm_experiences_source_kind_check
  CHECK (source_kind IS NULL OR source_kind IN (
    'work_close', 'import', 'calib', 'mimir_smeta', 'research', 'manual'
  ));

ALTER TABLE work_norm_change_log DROP CONSTRAINT IF EXISTS work_norm_change_log_action_check;
ALTER TABLE work_norm_change_log
  ADD CONSTRAINT work_norm_change_log_action_check
  CHECK (action IN (
    'create', 'update', 'delete', 'import', 'confirm', 'publish', 'reject', 'revert'
  ));

CREATE INDEX IF NOT EXISTS idx_work_norm_exp_target_rate
  ON work_norm_experiences(target_rate_id)
  WHERE target_rate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_work_norm_exp_source_work_kind
  ON work_norm_experiences(source_work_id, source_kind)
  WHERE source_work_id IS NOT NULL;
