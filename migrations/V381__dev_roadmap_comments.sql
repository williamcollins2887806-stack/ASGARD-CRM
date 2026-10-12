-- V381: Комментарии к пунктам дашборда разработки (доска/заметки с вложениями).
-- План вставить одной заметкой или комментарием к пункту; файл — вложение; скачивание открыто.
-- Права: писать/править/удалять по PIN; правит и удаляет ТОЛЬКО автор записи.

CREATE TABLE IF NOT EXISTS dev_roadmap_comments (
  id            SERIAL PRIMARY KEY,
  checkpoint_id INTEGER NOT NULL REFERENCES dev_roadmap_checkpoints(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  author_id     TEXT NOT NULL,
  author_name   TEXT NOT NULL,
  file_url      TEXT,
  file_name     TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dev_roadmap_comments_cp
  ON dev_roadmap_comments (checkpoint_id, created_at);
