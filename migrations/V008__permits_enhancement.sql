-- ═══════════════════════════════════════════════════════════════
-- V008: Допуски и разрешения — расширение (M6)
-- ═══════════════════════════════════════════════════════════════

-- 1. Расширить таблицу employee_permits
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS type_id VARCHAR(50);
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS category VARCHAR(30);
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS doc_number VARCHAR(100);
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS issuer VARCHAR(255);
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS scan_file VARCHAR(255);
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS scan_original_name VARCHAR(255);
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS notify_30_sent BOOLEAN DEFAULT false;
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS notify_14_sent BOOLEAN DEFAULT false;
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS notify_expired_sent BOOLEAN DEFAULT false;
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS created_by INTEGER;
ALTER TABLE employee_permits ADD COLUMN IF NOT EXISTS renewal_of INTEGER;  -- ссылка на предыдущий допуск (при продлении)

-- 2. Требования проектов — какие допуски нужны для конкретного проекта
CREATE TABLE IF NOT EXISTS work_permit_requirements (
  id SERIAL PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  permit_type_id VARCHAR(50) NOT NULL,                   -- из PERMIT_TYPES (height_1, electro_3 и т.д.)
  is_mandatory BOOLEAN DEFAULT true,                      -- обязательный или желательный
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Справочник типов допусков (серверный, вместо хардкода на фронте)
CREATE TABLE IF NOT EXISTS permit_types (
  id VARCHAR(50) PRIMARY KEY,                              -- 'height_1', 'electro_3' и т.д.
  name VARCHAR(255) NOT NULL,
  category VARCHAR(30) NOT NULL,                           -- 'safety', 'electric', 'special', 'medical', 'attest'
  validity_months INTEGER,                                 -- стандартный срок действия (для автозаполнения)
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true
);

-- Заполнить справочник из 20 типов, которые уже есть во фронтенде
INSERT INTO permit_types (id, name, category, validity_months, sort_order) VALUES
  ('height_1', 'Допуск к работам на высоте (1 группа)', 'safety', 36, 1),
  ('height_2', 'Допуск к работам на высоте (2 группа)', 'safety', 36, 2),
  ('height_3', 'Допуск к работам на высоте (3 группа)', 'safety', 60, 3),
  ('electro_2', 'Электробезопасность (II группа)', 'electric', 12, 10),
  ('electro_3', 'Электробезопасность (III группа)', 'electric', 12, 11),
  ('electro_4', 'Электробезопасность (IV группа)', 'electric', 12, 12),
  ('electro_5', 'Электробезопасность (V группа)', 'electric', 12, 13),
  ('fire', 'Пожарно-технический минимум (ПТМ)', 'safety', 36, 20),
  ('labor', 'Охрана труда (общий курс)', 'safety', 36, 21),
  ('confined', 'Работа в ограниченных пространствах', 'safety', 12, 22),
  ('pressure', 'Работа с сосудами под давлением', 'special', 12, 30),
  ('rigger', 'Стропальщик', 'special', 12, 31),
  ('tackle', 'Такелажник', 'special', 12, 32),
  ('gascutter', 'Газорезчик', 'special', 12, 33),
  ('welder', 'Сварщик (НАКС)', 'special', 48, 34),
  ('medical', 'Медицинский осмотр (периодический)', 'medical', 12, 40),
  ('psych', 'Психиатрическое освидетельствование', 'medical', 60, 41),
  ('attest_a1', 'Аттестация промбезопасность А1', 'attest', 60, 50),
  ('attest_b', 'Аттестация промбезопасность Б', 'attest', 60, 51),
  ('first_aid', 'Первая помощь пострадавшим', 'safety', 36, 23)
ON CONFLICT (id) DO NOTHING;

-- Индексы
CREATE INDEX IF NOT EXISTS idx_permits_employee ON employee_permits(employee_id);
CREATE INDEX IF NOT EXISTS idx_permits_type ON employee_permits(type_id);
CREATE INDEX IF NOT EXISTS idx_permits_expiry ON employee_permits(expiry_date);
CREATE INDEX IF NOT EXISTS idx_permits_active ON employee_permits(is_active);
CREATE INDEX IF NOT EXISTS idx_work_permit_req_work ON work_permit_requirements(work_id);

-- 4. Регистрация модулей в M1
INSERT INTO modules (key, label, description, category, icon, sort_order)
VALUES
  ('permits',       'Допуски и разрешения', 'Учёт допусков сотрудников',          'hr',   'workers', 42),
  ('permits_admin', 'Управление допусками', 'Администрирование справочника',      'hr',   'workers', 43)
ON CONFLICT (key) DO NOTHING;

-- 5. Пресеты ролей
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('HR', 'permits', true, true, true),
  ('HR', 'permits_admin', true, true, true),
  ('TO', 'permits', true, true, false),
  ('PM', 'permits', true, false, false),
  ('DIRECTOR_GEN', 'permits', true, true, true),
  ('DIRECTOR_GEN', 'permits_admin', true, true, true),
  ('DIRECTOR_COMM', 'permits', true, true, true),
  ('DIRECTOR_COMM', 'permits_admin', true, true, true),
  ('DIRECTOR_DEV', 'permits', true, true, true),
  ('DIRECTOR_DEV', 'permits_admin', true, true, true)
ON CONFLICT (role, module_key) DO NOTHING;

-- 6. Проставить пермишены существующим пользователям
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, rp.module_key, rp.can_read, rp.can_write, rp.can_delete, u.id
FROM users u
JOIN role_presets rp ON rp.role = u.role
WHERE u.is_active = true
  AND rp.module_key IN ('permits', 'permits_admin')
ON CONFLICT (user_id, module_key) DO NOTHING;

-- 7. Мигрировать данные из старого формата в новый
-- Старые записи используют permit_type (VARCHAR), новые — type_id (VARCHAR(50))
UPDATE employee_permits SET type_id = permit_type WHERE type_id IS NULL AND permit_type IS NOT NULL;
