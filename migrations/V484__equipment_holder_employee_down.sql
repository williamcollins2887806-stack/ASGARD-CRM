-- Rollback V484

ALTER TABLE equipment_requests
  DROP COLUMN IF EXISTS target_holder_employee_id;

ALTER TABLE equipment_movements
  DROP COLUMN IF EXISTS to_holder_employee_id,
  DROP COLUMN IF EXISTS from_holder_employee_id;

DROP INDEX IF EXISTS idx_equipment_holder_employee;

ALTER TABLE equipment
  DROP COLUMN IF EXISTS current_holder_employee_id;
