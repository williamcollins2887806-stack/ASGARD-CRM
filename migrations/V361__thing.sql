-- V361: Тинг — комнаты ВКС, запись, AI-протокол, dial-in 6 цифр
-- meetings.id = SERIAL (integer). LiveKit room name отдельно от slug/dial_code.

-- ─── thing_rooms ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS thing_rooms (
  id                  SERIAL PRIMARY KEY,
  meeting_id          INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  slug                VARCHAR(32) NOT NULL,
  dial_code           CHAR(6) NOT NULL,
  livekit_room_name   VARCHAR(128) NOT NULL,
  title               VARCHAR(500) NOT NULL,
  host_user_id        INTEGER NOT NULL REFERENCES users(id),
  mode                VARCHAR(20) NOT NULL DEFAULT 'instant'
                        CHECK (mode IN ('instant', 'scheduled')),
  status              VARCHAR(20) NOT NULL DEFAULT 'scheduled'
                        CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
  pin_code            CHAR(4),
  lobby_enabled       BOOLEAN NOT NULL DEFAULT false,
  allow_guests        BOOLEAN NOT NULL DEFAULT true,
  max_participants    INTEGER NOT NULL DEFAULT 50,
  max_video           INTEGER NOT NULL DEFAULT 3,
  recording_mode      VARCHAR(20) NOT NULL DEFAULT 'manual'
                        CHECK (recording_mode IN ('off', 'manual', 'auto')),
  protocol_enabled    BOOLEAN NOT NULL DEFAULT true,
  started_at          TIMESTAMPTZ,
  ended_at            TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT thing_rooms_dial_code_digits CHECK (dial_code ~ '^[0-9]{6}$'),
  CONSTRAINT thing_rooms_pin_digits CHECK (pin_code IS NULL OR pin_code ~ '^[0-9]{4}$'),
  CONSTRAINT thing_rooms_slug_format CHECK (slug ~ '^[a-z0-9]{4,32}$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_thing_rooms_slug ON thing_rooms (slug);
CREATE UNIQUE INDEX IF NOT EXISTS uq_thing_rooms_livekit ON thing_rooms (livekit_room_name);
-- dial_code уникален среди активных комнат (можно переиспользовать после ended)
CREATE UNIQUE INDEX IF NOT EXISTS uq_thing_rooms_dial_active
  ON thing_rooms (dial_code)
  WHERE status IN ('scheduled', 'live');

CREATE INDEX IF NOT EXISTS idx_thing_rooms_host ON thing_rooms (host_user_id);
CREATE INDEX IF NOT EXISTS idx_thing_rooms_meeting ON thing_rooms (meeting_id);
CREATE INDEX IF NOT EXISTS idx_thing_rooms_status ON thing_rooms (status);

-- ─── thing_participants ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS thing_participants (
  id              SERIAL PRIMARY KEY,
  room_id         INTEGER NOT NULL REFERENCES thing_rooms(id) ON DELETE CASCADE,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_name      VARCHAR(200),
  guest_email     VARCHAR(320),
  role            VARCHAR(20) NOT NULL DEFAULT 'member'
                    CHECK (role IN ('host', 'member', 'guest', 'phone')),
  display_name    VARCHAR(200) NOT NULL,
  identity        VARCHAR(128) NOT NULL,
  join_token_hash VARCHAR(64),
  lobby_status    VARCHAR(20) NOT NULL DEFAULT 'admitted'
                    CHECK (lobby_status IN ('waiting', 'admitted', 'rejected')),
  joined_at       TIMESTAMPTZ,
  left_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT thing_participants_identity_room UNIQUE (room_id, identity)
);

CREATE INDEX IF NOT EXISTS idx_thing_participants_room ON thing_participants (room_id);
CREATE INDEX IF NOT EXISTS idx_thing_participants_user ON thing_participants (user_id);

-- ─── thing_recordings ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS thing_recordings (
  id                   SERIAL PRIMARY KEY,
  room_id              INTEGER NOT NULL REFERENCES thing_rooms(id) ON DELETE CASCADE,
  egress_id            VARCHAR(128),
  file_path            TEXT,
  duration_sec         INTEGER,
  status               VARCHAR(20) NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'recording', 'ready', 'failed')),
  transcript_status    VARCHAR(20) NOT NULL DEFAULT 'none'
                         CHECK (transcript_status IN ('none', 'queued', 'processing', 'ready', 'failed')),
  transcript_segments  JSONB,
  protocol_status      VARCHAR(20) NOT NULL DEFAULT 'skipped'
                         CHECK (protocol_status IN (
                           'skipped', 'queued', 'transcribing', 'generating', 'ready', 'failed'
                         )),
  protocol_error       TEXT,
  started_at           TIMESTAMPTZ,
  ended_at             TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thing_recordings_room ON thing_recordings (room_id);
CREATE INDEX IF NOT EXISTS idx_thing_recordings_protocol
  ON thing_recordings (protocol_status)
  WHERE protocol_status IN ('queued', 'transcribing', 'generating');

-- ─── thing_protocol_runs ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS thing_protocol_runs (
  id            SERIAL PRIMARY KEY,
  recording_id  INTEGER NOT NULL REFERENCES thing_recordings(id) ON DELETE CASCADE,
  meeting_id    INTEGER REFERENCES meetings(id) ON DELETE SET NULL,
  model         VARCHAR(100),
  raw_json      JSONB,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'running', 'ready', 'failed')),
  error_text    TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_thing_protocol_runs_recording ON thing_protocol_runs (recording_id);

-- ─── thing_jobs (PG queue, без bull) ────────────────────────────
CREATE TABLE IF NOT EXISTS thing_jobs (
  id            SERIAL PRIMARY KEY,
  job_type      VARCHAR(50) NOT NULL,
  room_id       INTEGER REFERENCES thing_rooms(id) ON DELETE CASCADE,
  recording_id  INTEGER REFERENCES thing_recordings(id) ON DELETE CASCADE,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  status        VARCHAR(20) NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'processing', 'done', 'failed', 'retry')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  error         TEXT,
  scheduled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at    TIMESTAMPTZ,
  completed_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thing_jobs_poll
  ON thing_jobs (scheduled_at)
  WHERE status IN ('pending', 'retry');

-- ─── meetings: связь с Тингом ──────────────────────────────────
ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS thing_room_id INTEGER REFERENCES thing_rooms(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_meetings_thing_room ON meetings (thing_room_id);

-- ─── settings defaults (dial-in) ───────────────────────────────
INSERT INTO settings (key, value_json, updated_at)
VALUES
  ('thing_dialin_enabled', 'false', NOW()),
  ('thing_dialin_number', '""', NOW())
ON CONFLICT (key) DO NOTHING;
