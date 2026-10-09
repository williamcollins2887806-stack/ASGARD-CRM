-- V378: Huginn «удалить у себя» — per-user message hide.
--
-- DELETE /:chatId/messages/:id currently soft-deletes for EVERYONE (author/admin
-- only). Telegram also allows «удалить у себя» for any participant. That needs a
-- per-user marker, kept separate from chat_messages.deleted_at.
CREATE TABLE IF NOT EXISTS chat_message_hidden (
  message_id  INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_message_hidden_user ON chat_message_hidden (user_id);
