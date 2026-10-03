-- V363: dedicated Ting chat messages (leave thing_jobs for real jobs only)
CREATE TABLE IF NOT EXISTS thing_chat_messages (
  id          BIGSERIAL PRIMARY KEY,
  room_id     BIGINT NOT NULL REFERENCES thing_rooms(id) ON DELETE CASCADE,
  identity    TEXT,
  user_id     INT REFERENCES users(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL DEFAULT 'Участник',
  text        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thing_chat_room_id ON thing_chat_messages (room_id, id DESC);

-- Optional: migrate recent chat rows out of thing_jobs (best-effort)
INSERT INTO thing_chat_messages (room_id, identity, user_id, display_name, text, created_at)
SELECT
  j.room_id,
  NULLIF(j.payload->>'identity', ''),
  CASE WHEN (j.payload->>'user_id') ~ '^[0-9]+$' THEN (j.payload->>'user_id')::INT ELSE NULL END,
  COALESCE(NULLIF(j.payload->>'display_name', ''), NULLIF(j.payload->>'author', ''), 'Участник'),
  COALESCE(j.payload->>'text', ''),
  j.created_at
FROM thing_jobs j
WHERE j.job_type = 'thing_chat'
  AND j.room_id IS NOT NULL
  AND COALESCE(j.payload->>'text', '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM thing_chat_messages m
    WHERE m.room_id = j.room_id AND m.created_at = j.created_at AND m.text = COALESCE(j.payload->>'text', '')
  );
