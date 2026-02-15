-- ASGARD CRM — Test Seed Data
-- Создаёт тестовых пользователей для каждой роли (id 9000-9014)
-- Запуск: psql -U $DB_USER -d $DB_NAME -f tests/seed.sql

BEGIN;

-- Удалить предыдущие тестовые данные
DELETE FROM users WHERE id >= 9000 AND id < 9100;

-- Проверяем наличие pgcrypto для crypt()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Пароль: Test123!  PIN: 0000
DO $$
DECLARE
  pwd_hash TEXT;
  pin_hash TEXT;
BEGIN
  SELECT crypt('Test123!', gen_salt('bf', 10)) INTO pwd_hash;
  SELECT crypt('0000', gen_salt('bf', 10)) INTO pin_hash;

  INSERT INTO users (id, login, name, role, email, password_hash, pin_hash, is_active, is_approved)
  VALUES
    (9000, 'test_admin',           'Test ADMIN',           'ADMIN',           'test_admin@test.asgard.local',      pwd_hash, pin_hash, true, true),
    (9001, 'test_pm',              'Test PM',              'PM',              'test_pm@test.asgard.local',         pwd_hash, pin_hash, true, true),
    (9002, 'test_to',              'Test TO',              'TO',              'test_to@test.asgard.local',         pwd_hash, pin_hash, true, true),
    (9003, 'test_head_pm',         'Test HEAD_PM',         'HEAD_PM',         'test_head_pm@test.asgard.local',    pwd_hash, pin_hash, true, true),
    (9004, 'test_head_to',         'Test HEAD_TO',         'HEAD_TO',         'test_head_to@test.asgard.local',    pwd_hash, pin_hash, true, true),
    (9005, 'test_hr',              'Test HR',              'HR',              'test_hr@test.asgard.local',         pwd_hash, pin_hash, true, true),
    (9006, 'test_hr_manager',      'Test HR_MANAGER',      'HR_MANAGER',      'test_hr_manager@test.asgard.local', pwd_hash, pin_hash, true, true),
    (9007, 'test_buh',             'Test BUH',             'BUH',             'test_buh@test.asgard.local',        pwd_hash, pin_hash, true, true),
    (9008, 'test_proc',            'Test PROC',            'PROC',            'test_proc@test.asgard.local',       pwd_hash, pin_hash, true, true),
    (9009, 'test_office_manager',  'Test OFFICE_MANAGER',  'OFFICE_MANAGER',  'test_om@test.asgard.local',         pwd_hash, pin_hash, true, true),
    (9010, 'test_chief_engineer',  'Test CHIEF_ENGINEER',  'CHIEF_ENGINEER',  'test_ce@test.asgard.local',         pwd_hash, pin_hash, true, true),
    (9011, 'test_director_gen',    'Test DIRECTOR_GEN',    'DIRECTOR_GEN',    'test_dg@test.asgard.local',         pwd_hash, pin_hash, true, true),
    (9012, 'test_director_comm',   'Test DIRECTOR_COMM',   'DIRECTOR_COMM',   'test_dc@test.asgard.local',         pwd_hash, pin_hash, true, true),
    (9013, 'test_director_dev',    'Test DIRECTOR_DEV',    'DIRECTOR_DEV',    'test_dd@test.asgard.local',         pwd_hash, pin_hash, true, true),
    (9014, 'test_warehouse',       'Test WAREHOUSE',       'WAREHOUSE',       'test_wh@test.asgard.local',         pwd_hash, pin_hash, true, true)
  ON CONFLICT (id) DO UPDATE SET
    login = EXCLUDED.login,
    name = EXCLUDED.name,
    role = EXCLUDED.role,
    email = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash,
    pin_hash = EXCLUDED.pin_hash,
    is_active = true,
    is_approved = true;
END $$;

-- Обновляем sequence если нужно
SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 9014), true);

-- Тестовый сотрудник для staff-тестов
INSERT INTO employees (id, fio, role_tag, grade, phone, is_active)
VALUES (9100, 'Тест Рабочий Иванов', 'worker', '5', '+70000000001', true)
ON CONFLICT (id) DO UPDATE SET fio = EXCLUDED.fio, is_active = true;

COMMIT;
