-- V455 down: откат рыночного паритета Тинга, шаг 1

BEGIN;

DROP INDEX IF EXISTS idx_thing_webhook_room;
DROP TABLE IF EXISTS thing_webhook_events;

DROP INDEX IF EXISTS idx_thing_audit_action;
DROP INDEX IF EXISTS idx_thing_audit_room;
DROP TABLE IF EXISTS thing_audit_events;

DROP INDEX IF EXISTS idx_thing_participants_banned;
DROP INDEX IF EXISTS idx_thing_participants_guest_key;

ALTER TABLE thing_participants
  DROP COLUMN IF EXISTS consent_at,
  DROP COLUMN IF EXISTS can_publish,
  DROP COLUMN IF EXISTS banned_until,
  DROP COLUMN IF EXISTS client_ip,
  DROP COLUMN IF EXISTS guest_key;

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
    CHECK (role IN ('host', 'member', 'guest', 'phone'));
END $$;

ALTER TABLE thing_recordings
  DROP COLUMN IF EXISTS size_bytes,
  DROP COLUMN IF EXISTS error_text,
  DROP COLUMN IF EXISTS egress_status;

DROP INDEX IF EXISTS idx_thing_rooms_scheduled;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'thing_rooms' AND constraint_name = 'thing_rooms_lobby_policy_check'
  ) THEN
    ALTER TABLE thing_rooms DROP CONSTRAINT thing_rooms_lobby_policy_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'thing_rooms' AND constraint_name = 'thing_rooms_status_check'
  ) THEN
    ALTER TABLE thing_rooms DROP CONSTRAINT thing_rooms_status_check;
  END IF;
  UPDATE thing_rooms SET status = 'live' WHERE status = 'open';
  ALTER TABLE thing_rooms
    ADD CONSTRAINT thing_rooms_status_check
    CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled'));
END $$;

-- Вернуть индекс dial_code без статуса 'open'
DROP INDEX IF EXISTS uq_thing_rooms_dial_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_thing_rooms_dial_active
  ON thing_rooms (dial_code)
  WHERE status IN ('scheduled', 'live');

ALTER TABLE thing_rooms
  DROP COLUMN IF EXISTS updated_by,
  DROP COLUMN IF EXISTS recording_consent_mode,
  DROP COLUMN IF EXISTS lobby_policy,
  DROP COLUMN IF EXISTS locked,
  DROP COLUMN IF EXISTS scheduled_at;

COMMIT;
