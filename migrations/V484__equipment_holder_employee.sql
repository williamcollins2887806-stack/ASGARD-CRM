-- V484: выдача оборудования рабочим дружины (employees), не только users офиса
-- Откат: V484__equipment_holder_employee_down.sql

ALTER TABLE equipment
  ADD COLUMN IF NOT EXISTS current_holder_employee_id INTEGER REFERENCES employees(id);

CREATE INDEX IF NOT EXISTS idx_equipment_holder_employee
  ON equipment(current_holder_employee_id)
  WHERE current_holder_employee_id IS NOT NULL;

ALTER TABLE equipment_movements
  ADD COLUMN IF NOT EXISTS to_holder_employee_id INTEGER REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS from_holder_employee_id INTEGER REFERENCES employees(id);

ALTER TABLE equipment_requests
  ADD COLUMN IF NOT EXISTS target_holder_employee_id INTEGER REFERENCES employees(id);

COMMENT ON COLUMN equipment.current_holder_employee_id IS 'Держатель из дружины (employees); альтернатива current_holder_id (users)';
COMMENT ON COLUMN equipment_movements.to_holder_employee_id IS 'Получатель-сотрудник дружины при выдаче/передаче';
COMMENT ON COLUMN equipment_movements.from_holder_employee_id IS 'Сдающий сотрудник дружины при возврате/передаче';
