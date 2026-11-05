-- V456: Тинг — опросы в комнате (T21), вложения чата (T20), согласие на запись (Q09)
-- Источник: паритет с Яндекс.Телемост (опросы в звонке) и юридический контур.

BEGIN;

-- ─── Опросы (T21) ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS thing_polls (
  id          BIGSERIAL PRIMARY KEY,
  room_id     INTEGER NOT NULL REFERENCES thing_rooms(id) ON DELETE CASCADE,
  question    TEXT NOT NULL,
  options     JSONB NOT NULL DEFAULT '[]'::jsonb,
  multiple    BOOLEAN NOT NULL DEFAULT false,
  anonymous   BOOLEAN NOT NULL DEFAULT false,
  status      VARCHAR(20) NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'closed')),
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_thing_polls_room ON thing_polls (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS thing_poll_votes (
  id          BIGSERIAL PRIMARY KEY,
  poll_id     BIGINT NOT NULL REFERENCES thing_polls(id) ON DELETE CASCADE,
  identity    VARCHAR(128) NOT NULL,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  choices     JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT thing_poll_votes_unique UNIQUE (poll_id, identity)
);

CREATE INDEX IF NOT EXISTS idx_thing_poll_votes_poll ON thing_poll_votes (poll_id);

-- ─── Вложения чата (T20) ───────────────────────────────────────
ALTER TABLE thing_chat_messages
  ADD COLUMN IF NOT EXISTS file_url   TEXT,
  ADD COLUMN IF NOT EXISTS file_name  VARCHAR(300),
  ADD COLUMN IF NOT EXISTS file_size  BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type  VARCHAR(120);

-- ─── Согласие на запись (Q09) ──────────────────────────────────
-- consent_at уже добавлен в V455 на thing_participants.
-- Здесь — журнал согласий: кто, когда, на какую запись, и был ли отзыв.
CREATE TABLE IF NOT EXISTS thing_recording_consents (
  id           BIGSERIAL PRIMARY KEY,
  room_id      INTEGER NOT NULL REFERENCES thing_rooms(id) ON DELETE CASCADE,
  recording_id INTEGER REFERENCES thing_recordings(id) ON DELETE SET NULL,
  identity     VARCHAR(128) NOT NULL,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  granted_at   TIMESTAMPTZ,
  revoked_at   TIMESTAMPTZ,
  ip           INET,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thing_rec_consents_room
  ON thing_recording_consents (room_id, identity);

-- ─── Режимы конференции (C04/C05): smart meeting / podium / webinar ──
-- 'meeting' — все равны (по умолчанию);
-- 'podium'  — N спикеров публикуют, остальные слушают и просят слово;
-- 'webinar' — зрители не публикуют вообще, только чат и реакции.
ALTER TABLE thing_rooms
  ADD COLUMN IF NOT EXISTS conference_mode VARCHAR(20) NOT NULL DEFAULT 'meeting',
  ADD COLUMN IF NOT EXISTS speaker_slots   INTEGER NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS forced_layout   VARCHAR(20);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'thing_rooms' AND constraint_name = 'thing_rooms_conference_mode_check'
  ) THEN
    ALTER TABLE thing_rooms DROP CONSTRAINT thing_rooms_conference_mode_check;
  END IF;
  ALTER TABLE thing_rooms
    ADD CONSTRAINT thing_rooms_conference_mode_check
    CHECK (conference_mode IN ('meeting', 'podium', 'webinar'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'thing_rooms' AND constraint_name = 'thing_rooms_forced_layout_check'
  ) THEN
    ALTER TABLE thing_rooms DROP CONSTRAINT thing_rooms_forced_layout_check;
  END IF;
  ALTER TABLE thing_rooms
    ADD CONSTRAINT thing_rooms_forced_layout_check
    CHECK (forced_layout IS NULL OR forced_layout IN ('speaker', 'grid'));
END $$;

COMMIT;
