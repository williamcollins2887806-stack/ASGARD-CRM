DROP TABLE IF EXISTS meeting_exceptions;
DROP TABLE IF EXISTS meeting_guests;
DROP INDEX IF EXISTS idx_meetings_organizer;
DROP INDEX IF EXISTS idx_meetings_start_time;
DROP INDEX IF EXISTS idx_meetings_ics_uid;
ALTER TABLE meetings
  DROP COLUMN IF EXISTS conference_url,
  DROP COLUMN IF EXISTS ics_sequence,
  DROP COLUMN IF EXISTS ics_uid;
