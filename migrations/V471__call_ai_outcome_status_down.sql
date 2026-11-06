DROP INDEX IF EXISTS uq_telephony_jobs_active_per_call_type;
DROP INDEX IF EXISTS idx_call_history_ai_retryable;
DROP INDEX IF EXISTS idx_call_history_task_id;

ALTER TABLE call_history
  DROP COLUMN IF EXISTS ai_attempts,
  DROP COLUMN IF EXISTS ai_last_error_at,
  DROP COLUMN IF EXISTS ai_last_error,
  DROP COLUMN IF EXISTS ai_analysis_status,
  DROP COLUMN IF EXISTS task_id;

-- tags могли появиться только в V471; если колонка уже была на проде — DROP безопасен только если уверены.
-- Оставляем tags: используется missed-call INSERT и бейджами UI.
