BEGIN;

ALTER TABLE correspondence
  ALTER COLUMN subject TYPE TEXT;

ALTER TABLE correspondence
  ADD COLUMN IF NOT EXISTS body TEXT,
  ADD COLUMN IF NOT EXISTS content TEXT,
  ADD COLUMN IF NOT EXISTS email_id INTEGER,
  ADD COLUMN IF NOT EXISTS linked_inbox_application_id INTEGER,
  ADD COLUMN IF NOT EXISTS customer_id INTEGER,
  ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255),
  ADD COLUMN IF NOT EXISTS note TEXT,
  ADD COLUMN IF NOT EXISTS file_path TEXT,
  ADD COLUMN IF NOT EXISTS status VARCHAR(50);

UPDATE correspondence
SET body = content
WHERE body IS NULL AND content IS NOT NULL;

UPDATE correspondence
SET content = body
WHERE content IS NULL AND body IS NOT NULL;

CREATE TABLE IF NOT EXISTS correspondence_outgoing_counters (
  period_key VARCHAR(7) PRIMARY KEY,
  last_number INTEGER NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

INSERT INTO settings (key, value_json, created_at, updated_at)
SELECT 'correspondence_outgoing_start_number', '1', NOW(), NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM settings
  WHERE key = 'correspondence_outgoing_start_number'
);

COMMIT;
