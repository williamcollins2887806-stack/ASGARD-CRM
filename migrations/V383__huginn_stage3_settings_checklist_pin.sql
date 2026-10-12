-- V383: Huginn Этап 3 — настройки пользователя (A1), чек-листы сообщений (A11),
-- закрепление чатов (C2-pin). Corporate CRM, без монетизации.
-- Всё безопасно: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS.

-- ── A1: настройки уведомлений ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_notification_settings (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  push_enabled BOOLEAN NOT NULL DEFAULT true,
  sound_enabled BOOLEAN NOT NULL DEFAULT true,
  dnd_start    TIME,
  dnd_end      TIME,
  categories   JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── A1: настройки конфиденциальности ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_privacy_settings (
  user_id               INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  show_online           BOOLEAN NOT NULL DEFAULT true,
  show_phone            BOOLEAN NOT NULL DEFAULT true,
  allow_messages_from   VARCHAR(16) NOT NULL DEFAULT 'everyone',
  last_seen_visibility  VARCHAR(16) NOT NULL DEFAULT 'everyone',
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_privacy_allow_chk') THEN
    ALTER TABLE user_privacy_settings
      ADD CONSTRAINT user_privacy_allow_chk
      CHECK (allow_messages_from IN ('everyone', 'contacts', 'nobody'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'user_privacy_lastseen_chk') THEN
    ALTER TABLE user_privacy_settings
      ADD CONSTRAINT user_privacy_lastseen_chk
      CHECK (last_seen_visibility IN ('everyone', 'contacts', 'nobody'));
  END IF;
END $$;

-- ── A11: чек-листы внутри сообщений ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS message_checklist_items (
  id          SERIAL PRIMARY KEY,
  message_id  INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  text        TEXT NOT NULL,
  is_done     BOOLEAN NOT NULL DEFAULT false,
  done_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  done_at     TIMESTAMPTZ,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_checklist_message
  ON message_checklist_items (message_id, position, id);

-- ── C2-pin: закрепление чата (не сообщения) ──────────────────────────────────
ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_pinned BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_chats_pinned
  ON chats (is_pinned, pinned_at DESC) WHERE is_pinned = true;
