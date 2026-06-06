-- Rollback V163
DROP INDEX IF EXISTS idx_proc_items_recipient_work;
ALTER TABLE procurement_items
  DROP COLUMN IF EXISTS recipient_kind,
  DROP COLUMN IF EXISTS recipient_work_id;
