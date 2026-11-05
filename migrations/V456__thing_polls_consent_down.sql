-- V456 down: опросы, вложения чата, журнал согласий, режимы конференции

BEGIN;

DROP INDEX IF EXISTS idx_thing_rec_consents_room;
DROP TABLE IF EXISTS thing_recording_consents;

ALTER TABLE thing_chat_messages
  DROP COLUMN IF EXISTS mime_type,
  DROP COLUMN IF EXISTS file_size,
  DROP COLUMN IF EXISTS file_name,
  DROP COLUMN IF EXISTS file_url;

DROP INDEX IF EXISTS idx_thing_poll_votes_poll;
DROP TABLE IF EXISTS thing_poll_votes;
DROP INDEX IF EXISTS idx_thing_polls_room;
DROP TABLE IF EXISTS thing_polls;

-- Режимы конференции добавлялись в этом же V456 — снимаем их здесь же,
-- иначе откат оставляет колонки без возможности их убрать.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'thing_rooms' AND constraint_name = 'thing_rooms_forced_layout_check'
  ) THEN
    ALTER TABLE thing_rooms DROP CONSTRAINT thing_rooms_forced_layout_check;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'thing_rooms' AND constraint_name = 'thing_rooms_conference_mode_check'
  ) THEN
    ALTER TABLE thing_rooms DROP CONSTRAINT thing_rooms_conference_mode_check;
  END IF;
END $$;

ALTER TABLE thing_rooms
  DROP COLUMN IF EXISTS forced_layout,
  DROP COLUMN IF EXISTS speaker_slots,
  DROP COLUMN IF EXISTS conference_mode;

COMMIT;
