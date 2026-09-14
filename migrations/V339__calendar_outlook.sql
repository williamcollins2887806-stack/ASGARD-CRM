-- V339: Outlook-like calendar — guests, ICS, conference URL, exceptions

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE meetings
  ADD COLUMN IF NOT EXISTS ics_uid VARCHAR(255),
  ADD COLUMN IF NOT EXISTS ics_sequence INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conference_url VARCHAR(1000);

UPDATE meetings
SET ics_uid = 'meeting-' || id || '@asgard-crm.ru'
WHERE ics_uid IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meetings_ics_uid ON meetings (ics_uid) WHERE ics_uid IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_meetings_start_time ON meetings (start_time);
CREATE INDEX IF NOT EXISTS idx_meetings_organizer ON meetings (organizer_id);

CREATE TABLE IF NOT EXISTS meeting_guests (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  rsvp_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  rsvp_token UUID NOT NULL DEFAULT gen_random_uuid(),
  rsvp_comment TEXT,
  notified_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (meeting_id, email),
  UNIQUE (rsvp_token)
);

CREATE INDEX IF NOT EXISTS idx_meeting_guests_meeting ON meeting_guests (meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_guests_token ON meeting_guests (rsvp_token);

CREATE TABLE IF NOT EXISTS meeting_exceptions (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  exception_date DATE NOT NULL,
  is_cancelled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (meeting_id, exception_date)
);

CREATE INDEX IF NOT EXISTS idx_meeting_exceptions_meeting ON meeting_exceptions (meeting_id);
