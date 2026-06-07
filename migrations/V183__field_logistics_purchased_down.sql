-- Rollback V183
ALTER TABLE field_logistics
  DROP COLUMN IF EXISTS purchased_at,
  DROP COLUMN IF EXISTS purchased_by;
