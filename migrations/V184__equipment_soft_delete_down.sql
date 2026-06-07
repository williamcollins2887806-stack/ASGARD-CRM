DROP INDEX IF EXISTS idx_equipment_deleted_at;
ALTER TABLE equipment DROP COLUMN IF EXISTS deleted_at;
