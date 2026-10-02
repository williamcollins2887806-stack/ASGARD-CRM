-- V361 down: Тинг

ALTER TABLE meetings DROP COLUMN IF EXISTS thing_room_id;

DROP TABLE IF EXISTS thing_jobs;
DROP TABLE IF EXISTS thing_protocol_runs;
DROP TABLE IF EXISTS thing_recordings;
DROP TABLE IF EXISTS thing_participants;
DROP TABLE IF EXISTS thing_rooms;

DELETE FROM settings WHERE key IN ('thing_dialin_enabled', 'thing_dialin_number');
