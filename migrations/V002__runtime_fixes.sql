-- V002: Runtime fixes for test failures
-- Apply all DB schema changes, FK cascades, seed data, and permission fixes

-- ═══════════════════════════════════════════════════════════════
-- 1. SCHEMA FIXES
-- ═══════════════════════════════════════════════════════════════

-- Reminders: add missing columns
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS title VARCHAR(255);
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS reminder_date TIMESTAMPTZ;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'active';
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT false;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT false;

-- Employee assignments: add missing role column (payroll needs it)
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS role VARCHAR(100);

-- Permit applications: set default status to 'draft'
ALTER TABLE permit_applications ALTER COLUMN status SET DEFAULT 'draft';
UPDATE permit_applications SET status = 'draft' WHERE status IS NULL;

-- ═══════════════════════════════════════════════════════════════
-- 2. FK CASCADES (drop and re-create with ON DELETE CASCADE)
-- ═══════════════════════════════════════════════════════════════

-- employee_permits.employee_id → employees
ALTER TABLE employee_permits DROP CONSTRAINT IF EXISTS employee_permits_employee_id_fkey;
ALTER TABLE employee_permits ADD CONSTRAINT employee_permits_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

-- permit_application_items.application_id → permit_applications
ALTER TABLE permit_application_items DROP CONSTRAINT IF EXISTS permit_application_items_application_id_fkey;
ALTER TABLE permit_application_items ADD CONSTRAINT permit_application_items_application_id_fkey
  FOREIGN KEY (application_id) REFERENCES permit_applications(id) ON DELETE CASCADE;

-- permit_application_history.application_id → permit_applications
ALTER TABLE permit_application_history DROP CONSTRAINT IF EXISTS permit_application_history_application_id_fkey;
ALTER TABLE permit_application_history ADD CONSTRAINT permit_application_history_application_id_fkey
  FOREIGN KEY (application_id) REFERENCES permit_applications(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════
-- 3. SEED DATA
-- ═══════════════════════════════════════════════════════════════

-- Admin user for login tests (password: admin123)
INSERT INTO users (login, password_hash, name, role, is_active, created_at)
VALUES ('admin', '$2a$10$YzQbN0MQkJKlRCwCVrNfj.VBSDeHDvVqLPR4bUl0t3qIfA4qlSGQK', 'Администратор', 'ADMIN', true, NOW())
ON CONFLICT (login) DO NOTHING;

-- Employees with IDs 1 and 2 (for FK-safe tests)
INSERT INTO employees (id, fio, full_name, is_active, created_at, updated_at)
VALUES (1, 'Тест Сотрудник 1', 'Тест Сотрудник 1', true, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, fio, full_name, is_active, created_at, updated_at)
VALUES (2, 'Тест Сотрудник 2', 'Тест Сотрудник 2', true, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Employees matching test user IDs (9000-9014)
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9000, 'Test ADMIN', 'Test Employee ADMIN', true, 'ADMIN', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9001, 'Test PM', 'Test Employee PM', true, 'PM', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9002, 'Test TO', 'Test Employee TO', true, 'TO', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9003, 'Test HEAD_PM', 'Test Employee HEAD_PM', true, 'HEAD_PM', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9004, 'Test HEAD_TO', 'Test Employee HEAD_TO', true, 'HEAD_TO', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9005, 'Test HR', 'Test Employee HR', true, 'HR', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9006, 'Test HR_MANAGER', 'Test Employee HR_MANAGER', true, 'HR_MANAGER', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9007, 'Test BUH', 'Test Employee BUH', true, 'BUH', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9008, 'Test PROC', 'Test Employee PROC', true, 'PROC', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9009, 'Test OFFICE_MANAGER', 'Test Employee OFFICE_MANAGER', true, 'OFFICE_MANAGER', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9010, 'Test CHIEF_ENGINEER', 'Test Employee CHIEF_ENGINEER', true, 'CHIEF_ENGINEER', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9011, 'Test DIRECTOR_GEN', 'Test Employee DIRECTOR_GEN', true, 'DIRECTOR_GEN', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9012, 'Test DIRECTOR_COMM', 'Test Employee DIRECTOR_COMM', true, 'DIRECTOR_COMM', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9013, 'Test DIRECTOR_DEV', 'Test Employee DIRECTOR_DEV', true, 'DIRECTOR_DEV', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9014, 'Test WAREHOUSE', 'Test Employee WAREHOUSE', true, 'WAREHOUSE', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;

-- Update employees sequence
SELECT setval('employees_id_seq', GREATEST((SELECT MAX(id) FROM employees), 9014));

-- Permit types (needed for permit creation tests)
INSERT INTO permit_types (id, code, name, category, is_active, created_at)
VALUES (1, 'safety_basic', 'Допуск по безопасности', 'safety', true, NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO permit_types (id, code, name, category, is_active, created_at)
VALUES (2, 'electric_basic', 'Допуск электрика', 'electric', true, NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO permit_types (id, code, name, category, is_active, created_at)
VALUES (3, 'height_work', 'Допуск к высотным работам', 'special', true, NOW())
ON CONFLICT (id) DO NOTHING;

SELECT setval('permit_types_id_seq', GREATEST((SELECT MAX(id) FROM permit_types), 3));

-- Equipment requests seed (status must be 'new')
INSERT INTO equipment_requests (id, requester_id, equipment_name, quantity, status, created_at)
SELECT 1, u.id, 'Тест оборудование', 1, 'new', NOW()
FROM users u WHERE u.role = 'ADMIN' LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- Staff requests seed (status must be 'new')
INSERT INTO staff_requests (id, requester_id, position_name, quantity, status, created_at)
SELECT 1, u.id, 'Тест вакансия', 1, 'new', NOW()
FROM users u WHERE u.role = 'ADMIN' LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- Fix status values if they exist with wrong status
UPDATE equipment_requests SET status = 'new' WHERE status = 'pending' AND id <= 5;
UPDATE staff_requests SET status = 'new' WHERE status = 'pending' AND id <= 5;

-- ═══════════════════════════════════════════════════════════════
-- 4. PERMISSION FIXES (role_presets and user_permissions)
-- ═══════════════════════════════════════════════════════════════

-- Remove wrong role/module combinations from role_presets
DELETE FROM role_presets WHERE role IN ('PM', 'HEAD_PM', 'HEAD_TO') AND module = 'tasks_admin';
DELETE FROM role_presets WHERE role = 'HEAD_PM' AND module = 'cash_admin';
DELETE FROM role_presets WHERE role = 'CHIEF_ENGINEER' AND module = 'permits';

-- Add BUH cash permission (read-only, can't approve)
INSERT INTO role_presets (role, module, can_read, can_write, created_at)
VALUES ('BUH', 'cash', true, false, NOW())
ON CONFLICT (role, module) DO UPDATE SET can_read = true;

-- BUH cash_admin should be read-only
UPDATE role_presets SET can_write = false WHERE role = 'BUH' AND module = 'cash_admin';

-- Clean up user_permissions that shouldn't exist
DELETE FROM user_permissions WHERE module = 'tasks_admin'
  AND user_id IN (SELECT id FROM users WHERE role IN ('PM', 'HEAD_PM', 'HEAD_TO'));
DELETE FROM user_permissions WHERE module = 'cash_admin'
  AND user_id IN (SELECT id FROM users WHERE role = 'HEAD_PM');
