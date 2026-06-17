-- V223 down: убрать расширения inbox_applications.
-- Перед DROP CONSTRAINT приводим status='assigned' к ближайшему совместимому
-- значению из старого CHECK ('under_review'), чтобы откат не падал.

UPDATE inbox_applications SET status='under_review' WHERE status='assigned';

DROP INDEX IF EXISTS idx_inbox_applications_needs_review;
DROP INDEX IF EXISTS idx_inbox_applications_unassigned;
DROP INDEX IF EXISTS idx_inbox_applications_assigned_pm;

ALTER TABLE inbox_applications DROP CONSTRAINT IF EXISTS inbox_applications_status_check;
ALTER TABLE inbox_applications ADD CONSTRAINT inbox_applications_status_check
  CHECK (status::text = ANY (ARRAY[
    'new'::character varying::text,
    'ai_processed'::character varying::text,
    'under_review'::character varying::text,
    'accepted'::character varying::text,
    'rejected'::character varying::text,
    'archived'::character varying::text
  ]));

ALTER TABLE inbox_applications DROP CONSTRAINT IF EXISTS chk_inbox_applications_source_kind;

ALTER TABLE inbox_applications
  DROP COLUMN IF EXISTS original_sender_name,
  DROP COLUMN IF EXISTS original_sender_email,
  DROP COLUMN IF EXISTS needs_review,
  DROP COLUMN IF EXISTS source_kind,
  DROP COLUMN IF EXISTS forwarded_from_email,
  DROP COLUMN IF EXISTS forwarded_by_user_id,
  DROP COLUMN IF EXISTS assigned_at,
  DROP COLUMN IF EXISTS assigned_by,
  DROP COLUMN IF EXISTS assigned_pm_id;
