-- Huginn 1:1 calls (LiveKit-backed) + favorite flag for chats.
-- Rollback point is a prod snapshot; down drops only the objects created here.

CREATE TABLE IF NOT EXISTS huginn_calls (
  id            SERIAL PRIMARY KEY,
  chat_id       INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  caller_id     INTEGER NOT NULL REFERENCES users(id),
  callee_id     INTEGER NOT NULL REFERENCES users(id),
  kind          VARCHAR(8) NOT NULL DEFAULT 'audio',
  status        VARCHAR(12) NOT NULL DEFAULT 'ringing',
  livekit_room  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  answered_at   TIMESTAMPTZ,
  ended_at      TIMESTAMPTZ,
  duration_sec  INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE huginn_calls DROP CONSTRAINT IF EXISTS huginn_calls_kind_chk;
ALTER TABLE huginn_calls ADD CONSTRAINT huginn_calls_kind_chk
  CHECK (kind IN ('audio', 'video'));

ALTER TABLE huginn_calls DROP CONSTRAINT IF EXISTS huginn_calls_status_chk;
ALTER TABLE huginn_calls ADD CONSTRAINT huginn_calls_status_chk
  CHECK (status IN ('ringing', 'active', 'ended', 'missed', 'declined', 'canceled'));

CREATE INDEX IF NOT EXISTS idx_huginn_calls_callee_status
  ON huginn_calls (callee_id, status);
CREATE INDEX IF NOT EXISTS idx_huginn_calls_caller_status
  ON huginn_calls (caller_id, status);
CREATE INDEX IF NOT EXISTS idx_huginn_calls_chat
  ON huginn_calls (chat_id, created_at DESC);

-- At most one live (ringing/active) call per chat: closes the double-POST race.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_huginn_calls_live_chat
  ON huginn_calls (chat_id)
  WHERE status IN ('ringing', 'active');

-- "Избранное": per-user flag on a chat.
ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_favorite BOOLEAN NOT NULL DEFAULT false;
