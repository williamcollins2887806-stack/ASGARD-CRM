-- V383 down: откат Этапа 3 (настройки, чек-листы, pin чата).
-- Удаляем только объекты, созданные V383. Идемпотентно.

DROP INDEX IF EXISTS idx_chats_pinned;
ALTER TABLE chats DROP COLUMN IF EXISTS pinned_at;
ALTER TABLE chats DROP COLUMN IF EXISTS is_pinned;

DROP INDEX IF EXISTS idx_message_checklist_message;
DROP TABLE IF EXISTS message_checklist_items;

DROP TABLE IF EXISTS user_privacy_settings;
DROP TABLE IF EXISTS user_notification_settings;
