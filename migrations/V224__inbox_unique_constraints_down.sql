-- V224 down: убрать UNIQUE индексы.
-- DELETE дубликатов из up-миграции — НЕОБРАТИМ.
DROP INDEX IF EXISTS uq_inbox_applications_email_id;
DROP INDEX IF EXISTS uq_emails_message_id;
