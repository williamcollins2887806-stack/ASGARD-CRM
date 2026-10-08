-- V377: Huginn member tags (метки участников чата).
--
-- The design-book contract lists «member tags / checklist» as the only open
-- defer_be item. Tags are per (chat, member): a short label the chat owner/admin
-- puts on a participant (e.g. «заказчик», «подрядчик»). Kept tiny on purpose.
CREATE TABLE IF NOT EXISTS chat_member_tags (
  id          BIGSERIAL PRIMARY KEY,
  chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tag         VARCHAR(32) NOT NULL,
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (chat_id, user_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_chat_member_tags_chat ON chat_member_tags (chat_id, user_id);
