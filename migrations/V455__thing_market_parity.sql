-- V455: Тинг — рыночный паритет, шаг 1 (Фаза 0–2)
-- D15: scheduled_at не сохранялся — «Запланировать» создавал комнату без времени.
-- D16: instant-комната сразу 'live' → вечные «живые» комнаты. Отдельный статус 'open'.
-- D1:  нет PATCH /rooms — нельзя менять PIN/лимиты/лобби/режим записи после создания.
-- D4:  гость получал новый identity на каждый вход → кик обходился F5.
-- D25: consent_required был константой, согласие нигде не собиралось.
-- D24: комната без livekit_room_name до первого входа.

BEGIN;

-- ─── thing_rooms: новые поля ────────────────────────────────────
ALTER TABLE thing_rooms
  ADD COLUMN IF NOT EXISTS scheduled_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS lobby_policy    VARCHAR(20) NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS recording_consent_mode VARCHAR(20) NOT NULL DEFAULT 'host_only',
  ADD COLUMN IF NOT EXISTS updated_by      INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- D16: 'open' = комната создана, но ещё никто не входил (раньше сразу 'live').
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'thing_rooms' AND constraint_name = 'thing_rooms_status_check'
  ) THEN
    ALTER TABLE thing_rooms DROP CONSTRAINT thing_rooms_status_check;
  END IF;
  ALTER TABLE thing_rooms
    ADD CONSTRAINT thing_rooms_status_check
    CHECK (status IN ('open', 'scheduled', 'live', 'ended', 'cancelled'));
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'thing_rooms' AND constraint_name = 'thing_rooms_lobby_policy_check'
  ) THEN
    ALTER TABLE thing_rooms DROP CONSTRAINT thing_rooms_lobby_policy_check;
  END IF;
  ALTER TABLE thing_rooms
    ADD CONSTRAINT thing_rooms_lobby_policy_check
    CHECK (lobby_policy IN ('all', 'guests', 'uninvited'));
END $$;

CREATE INDEX IF NOT EXISTS idx_thing_rooms_scheduled
  ON thing_rooms (scheduled_at) WHERE status = 'scheduled';

-- ─── thing_participants: роли модерации (Фаза 2) ───────────────
-- host → co_host → moderator → member → guest → phone
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'thing_participants' AND constraint_name = 'thing_participants_role_check'
  ) THEN
    ALTER TABLE thing_participants DROP CONSTRAINT thing_participants_role_check;
  END IF;
  ALTER TABLE thing_participants
    ADD CONSTRAINT thing_participants_role_check
    CHECK (role IN ('host', 'co_host', 'moderator', 'member', 'guest', 'phone'));
END $$;

ALTER TABLE thing_participants
  -- D4: стабильный ключ гостя, чтобы кик/бан не обходился перезагрузкой
  ADD COLUMN IF NOT EXISTS guest_key    VARCHAR(128),
  ADD COLUMN IF NOT EXISTS client_ip    INET,
  ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS can_publish  BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS consent_at   TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_thing_participants_guest_key
  ON thing_participants (room_id, guest_key) WHERE guest_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_thing_participants_banned
  ON thing_participants (room_id, guest_key) WHERE banned_until IS NOT NULL;

-- ─── thing_audit_events (D: журнал admission/kick/rec/PIN) ─────
CREATE TABLE IF NOT EXISTS thing_audit_events (
  id          BIGSERIAL PRIMARY KEY,
  room_id     INTEGER REFERENCES thing_rooms(id) ON DELETE CASCADE,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role  VARCHAR(40),
  action      VARCHAR(60) NOT NULL,
  target      VARCHAR(200),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  ip          INET,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thing_audit_room  ON thing_audit_events (room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_thing_audit_action ON thing_audit_events (action, created_at DESC);

-- ─── thing_webhook_events (идемпотентность LiveKit webhook) ────
CREATE TABLE IF NOT EXISTS thing_webhook_events (
  event_id    VARCHAR(128) PRIMARY KEY,
  event_type  VARCHAR(60) NOT NULL,
  room_name   VARCHAR(128),
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  processed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thing_webhook_room
  ON thing_webhook_events (room_name, created_at DESC);

-- ─── thing_recordings: поле для идемпотентного завершения ──────
ALTER TABLE thing_recordings
  ADD COLUMN IF NOT EXISTS egress_status VARCHAR(40),
  ADD COLUMN IF NOT EXISTS error_text    TEXT,
  ADD COLUMN IF NOT EXISTS size_bytes    BIGINT;

-- ─── dial_code: уникальность среди АКТИВНЫХ комнат ──────────────
-- Индекс из V361 покрывает только ('scheduled','live'), а instant-комнаты теперь
-- создаются как 'open'. Из-за этого две open-комнаты получали один код, а
-- dial-in/resolve с LIMIT 1 мог отдать чужую комнату.
DROP INDEX IF EXISTS uq_thing_rooms_dial_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_thing_rooms_dial_active
  ON thing_rooms (dial_code)
  WHERE status IN ('open', 'scheduled', 'live');

-- ─── backfill: instant-комнаты без входа → 'open' (а не 'live') ─
UPDATE thing_rooms r
   SET status = 'open'
 WHERE r.status = 'live'
   AND NOT EXISTS (
     SELECT 1 FROM thing_participants p
      WHERE p.room_id = r.id AND p.joined_at IS NOT NULL
   );

COMMIT;
