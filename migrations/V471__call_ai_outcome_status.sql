-- V471: outcome звонка → task_id + статус AI-анализа (retry при 402/сети)

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb;

ALTER TABLE call_history
  ADD COLUMN IF NOT EXISTS task_id INTEGER REFERENCES tasks(id),
  ADD COLUMN IF NOT EXISTS ai_analysis_status VARCHAR(32),
  ADD COLUMN IF NOT EXISTS ai_last_error TEXT,
  ADD COLUMN IF NOT EXISTS ai_last_error_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_attempts INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN call_history.task_id IS
  'Задача follow-up из AI-анализа звонка (не missed_task_id)';
COMMENT ON COLUMN call_history.ai_analysis_status IS
  'pending|done|skipped|error_retryable|error_final — NULL = legacy';
COMMENT ON COLUMN call_history.ai_last_error IS
  'Последняя ошибка AI/STT (infra), без записи в ai_summary';
COMMENT ON COLUMN call_history.ai_attempts IS
  'Счётчик content-попыток analyze (infra не жжёт лимит)';

CREATE INDEX IF NOT EXISTS idx_call_history_task_id
  ON call_history (task_id)
  WHERE task_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_history_ai_retryable
  ON call_history (ai_analysis_status)
  WHERE ai_analysis_status = 'error_retryable';

-- Перед уникальным индексом: оставить один активный job на (call_id, job_type)
DELETE FROM telephony_jobs a
  USING telephony_jobs b
 WHERE a.call_id IS NOT NULL
   AND a.call_id = b.call_id
   AND a.job_type = b.job_type
   AND a.status IN ('pending', 'processing', 'retry')
   AND b.status IN ('pending', 'processing', 'retry')
   AND a.id > b.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_telephony_jobs_active_per_call_type
  ON telephony_jobs (call_id, job_type)
  WHERE status IN ('pending', 'processing', 'retry') AND call_id IS NOT NULL;
