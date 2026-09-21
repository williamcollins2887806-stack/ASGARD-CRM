-- V355 down: откат счётчика попыток AI-разбора (D-204)

ALTER TABLE emails DROP COLUMN IF EXISTS ai_last_error_at;
ALTER TABLE emails DROP COLUMN IF EXISTS ai_attempts;
