BEGIN;

ALTER TABLE mlsp_applications
  DROP CONSTRAINT IF EXISTS mlsp_applications_status_chk;

-- откат: received → sent, чтобы пройти старый CHECK
UPDATE mlsp_applications SET status = 'sent' WHERE status = 'received';

ALTER TABLE mlsp_applications
  ADD CONSTRAINT mlsp_applications_status_chk CHECK (status IN (
    'draft', 'exported', 'sent', 'cancelled'
  ));

ALTER TABLE mlsp_applications
  DROP COLUMN IF EXISTS sent_at,
  DROP COLUMN IF EXISTS received_at;

COMMIT;
