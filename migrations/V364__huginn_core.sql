-- V364: Huginn realtime / media / invites (D-huginn)
-- Safe: IF NOT EXISTS / ADD COLUMN IF NOT EXISTS

-- Presence: durable last_seen
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_huginn_guest BOOLEAN NOT NULL DEFAULT false;

-- Per-user read receipts
CREATE TABLE IF NOT EXISTS chat_message_reads (
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_user
  ON chat_message_reads (user_id, read_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_message_reads_msg
  ON chat_message_reads (message_id);

-- SSE / catch-up outbox (monotone id)
CREATE TABLE IF NOT EXISTS huginn_events (
  id         BIGSERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload    JSONB NOT NULL DEFAULT '{}'::jsonb,
  chat_id    INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_huginn_events_user_id
  ON huginn_events (user_id, id);
CREATE INDEX IF NOT EXISTS idx_huginn_events_created
  ON huginn_events (created_at);

-- Voice STT jobs (SpeechKit) — separate from telephony/thing
CREATE TABLE IF NOT EXISTS chat_voice_jobs (
  id           BIGSERIAL PRIMARY KEY,
  message_id   INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  chat_id      INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','running','done','failed')),
  transcript   TEXT,
  error_text   TEXT,
  attempts     INTEGER NOT NULL DEFAULT 0,
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_chat_voice_jobs_pending
  ON chat_voice_jobs (status, scheduled_at)
  WHERE status IN ('pending','running');

-- Story views (user_stories already exists)
CREATE TABLE IF NOT EXISTS chat_story_views (
  story_id  INTEGER NOT NULL REFERENCES user_stories(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (story_id, user_id)
);

ALTER TABLE user_stories ADD COLUMN IF NOT EXISTS media_url TEXT;
ALTER TABLE user_stories ADD COLUMN IF NOT EXISTS media_type TEXT DEFAULT 'text';

-- Stickers
CREATE TABLE IF NOT EXISTS chat_sticker_packs (
  id         SERIAL PRIMARY KEY,
  slug       TEXT NOT NULL UNIQUE,
  title      TEXT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_stickers (
  id         SERIAL PRIMARY KEY,
  pack_id    INTEGER NOT NULL REFERENCES chat_sticker_packs(id) ON DELETE CASCADE,
  slug       TEXT NOT NULL,
  image_url  TEXT NOT NULL,
  emoji      TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE (pack_id, slug)
);

INSERT INTO chat_sticker_packs (slug, title)
VALUES ('asgard-basic', 'ASGARD')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO chat_stickers (pack_id, slug, image_url, emoji, sort_order)
SELECT p.id, v.slug, v.image_url, v.emoji, v.sort_order
FROM chat_sticker_packs p
CROSS JOIN (VALUES
  ('ok',      '/assets/huginn/stickers/ok.svg', '👍', 1),
  ('fire',    '/assets/huginn/stickers/fire.svg', '🔥', 2),
  ('check',   '/assets/huginn/stickers/check.svg', '✅', 3),
  ('wave',    '/assets/huginn/stickers/wave.svg', '👋', 4),
  ('think',   '/assets/huginn/stickers/think.svg', '🤔', 5)
) AS v(slug, image_url, emoji, sort_order)
WHERE p.slug = 'asgard-basic'
ON CONFLICT (pack_id, slug) DO NOTHING;

-- Invites (guests only by invite)
CREATE TABLE IF NOT EXISTS huginn_invites (
  id              BIGSERIAL PRIMARY KEY,
  token           TEXT NOT NULL UNIQUE,
  inviter_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone           TEXT,
  email           TEXT,
  display_name    TEXT,
  chat_id         INTEGER,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '7 days'),
  accepted_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at     TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_huginn_invites_token ON huginn_invites (token);
CREATE INDEX IF NOT EXISTS idx_huginn_invites_status ON huginn_invites (status, expires_at);

-- Link Ting rooms ↔ chats (optional)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'thing_rooms') THEN
    ALTER TABLE thing_rooms ADD COLUMN IF NOT EXISTS chat_id INTEGER;
    CREATE INDEX IF NOT EXISTS idx_thing_rooms_chat_id ON thing_rooms (chat_id);
  END IF;
END $$;

-- Helpful indexes for huginn message types
CREATE INDEX IF NOT EXISTS idx_chat_messages_type_msg
  ON chat_messages (chat_id, message_type)
  WHERE deleted_at IS NULL;
