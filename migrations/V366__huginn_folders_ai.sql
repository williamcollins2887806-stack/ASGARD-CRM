-- V366: Huginn chat folders (F10) + AI editor styles / audit (F11)
-- No premium / monetization — corporate CRM, all authenticated users.
-- Safe: IF NOT EXISTS

-- Active folder preference (optional UI state)
ALTER TABLE users ADD COLUMN IF NOT EXISTS huginn_active_folder_id INTEGER;

CREATE TABLE IF NOT EXISTS huginn_chat_folders (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  icon_emoji  TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_system   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_huginn_chat_folders_user
  ON huginn_chat_folders (user_id, sort_order, id);

CREATE TABLE IF NOT EXISTS huginn_chat_folder_members (
  folder_id   INTEGER NOT NULL REFERENCES huginn_chat_folders(id) ON DELETE CASCADE,
  chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (folder_id, chat_id)
);
CREATE INDEX IF NOT EXISTS idx_huginn_folder_members_chat
  ON huginn_chat_folder_members (chat_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_huginn_active_folder_id_fkey'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_huginn_active_folder_id_fkey
      FOREIGN KEY (huginn_active_folder_id)
      REFERENCES huginn_chat_folders(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Custom AI styles (user-owned prompts)
CREATE TABLE IF NOT EXISTS huginn_ai_styles (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  icon_emoji   TEXT,
  prompt       TEXT NOT NULL,
  share_token  TEXT UNIQUE,
  is_public    BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_huginn_ai_styles_user
  ON huginn_ai_styles (user_id, id DESC);

-- Audit / rate-limit evidence (no training claim; server-side processing)
CREATE TABLE IF NOT EXISTS huginn_ai_editor_log (
  id           BIGSERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode         TEXT NOT NULL,
  style_id     INTEGER REFERENCES huginn_ai_styles(id) ON DELETE SET NULL,
  chars_in     INTEGER NOT NULL DEFAULT 0,
  chars_out    INTEGER NOT NULL DEFAULT 0,
  ok           BOOLEAN NOT NULL DEFAULT true,
  error_text   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_huginn_ai_editor_log_user_ts
  ON huginn_ai_editor_log (user_id, created_at DESC);
