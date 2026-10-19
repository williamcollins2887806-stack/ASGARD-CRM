-- V410 (down): откат таблицы алиасов и флага приёма счетов.
DROP INDEX IF EXISTS idx_user_email_aliases_unassigned;
DROP INDEX IF EXISTS idx_user_email_aliases_user;
DROP INDEX IF EXISTS uq_user_email_aliases_email;
DROP TABLE IF EXISTS user_email_aliases;

-- Флаг возвращаем в safety-значение (как создала V398).
UPDATE settings SET value_json = 'false', updated_at = NOW() WHERE key = 'email_intake_enabled';
