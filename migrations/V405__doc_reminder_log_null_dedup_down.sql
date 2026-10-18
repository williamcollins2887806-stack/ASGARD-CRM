-- V405 down: вернуть прежнюю схему антидубля.
DROP INDEX IF EXISTS uq_doc_reminder_log_task;

-- Идемпотентно (FAIL верификатора 17.10): повторный прогон down падал на
-- «constraint already exists». ADD CONSTRAINT не поддерживает IF NOT EXISTS —
-- оборачиваем в проверку каталога.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'doc_reminder_log_doc_id_user_id_kind_due_date_key'
  ) THEN
    ALTER TABLE doc_reminder_log
      ADD CONSTRAINT doc_reminder_log_doc_id_user_id_kind_due_date_key
      UNIQUE (doc_id, user_id, kind, due_date);
  END IF;
END $$;

-- Снимаем сентинел: «без срока» снова NULL (дубли при NULL вернутся — старое поведение).
UPDATE doc_reminder_log SET due_date = NULL WHERE due_date = DATE '9999-12-31';
ALTER TABLE doc_reminder_log ALTER COLUMN due_date DROP DEFAULT;
