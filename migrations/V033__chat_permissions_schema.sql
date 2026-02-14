-- V033: Add missing columns for chat_groups & permissions system
-- ================================================================

-- 1. Модули — справочник для системы пермишенов
CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  module_key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  sort_order INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Пресеты ролей — какие роли что могут по умолчанию
CREATE TABLE IF NOT EXISTS role_presets (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL,
  module_key TEXT NOT NULL,
  can_read BOOLEAN DEFAULT false,
  can_write BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  UNIQUE(role, module_key)
);

-- 3. Индивидуальные пермишены юзера (перекрывают пресеты)
CREATE TABLE IF NOT EXISTS user_permissions (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_key TEXT NOT NULL,
  can_read BOOLEAN DEFAULT false,
  can_write BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  UNIQUE(user_id, module_key)
);

-- 4. chats: недостающие колонки
ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT true;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS avatar_path TEXT;

-- 5. chat_group_members: недостающие колонки
ALTER TABLE chat_group_members ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'member';
ALTER TABLE chat_group_members ADD COLUMN IF NOT EXISTS muted_until TIMESTAMPTZ;
ALTER TABLE chat_group_members ADD COLUMN IF NOT EXISTS last_read_at TIMESTAMPTZ;

-- 6. chat_messages: недостающие колонки для replies/attachments
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to INT REFERENCES chat_messages(id);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_path TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS attachment_name TEXT;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- 7. Заполняем modules для всех модулей системы
INSERT INTO modules (module_key, name, sort_order) VALUES
  ('tenders', 'Тендеры', 10),
  ('works', 'Работы', 20),
  ('estimates', 'Сметы', 30),
  ('invoices', 'Счета', 40),
  ('cash', 'Кассовые заявки', 50),
  ('expenses', 'Расходы', 60),
  ('incomes', 'Доходы', 70),
  ('staff', 'Персонал', 80),
  ('equipment', 'Оборудование', 90),
  ('customers', 'Контрагенты', 100),
  ('tkp', 'ТКП', 110),
  ('pass_requests', 'Заявки на пропуск', 120),
  ('tmc_requests', 'Заявки на ТМЦ', 130),
  ('chat_groups', 'Групповые чаты', 140),
  ('tasks', 'Задачи', 145),
  ('tasks_admin', 'Задачи (все)', 146),
  ('notifications', 'Уведомления', 150),
  ('calendar', 'Календарь', 160),
  ('reports', 'Отчёты', 170),
  ('settings', 'Настройки', 180),
  ('users', 'Пользователи', 190),
  ('permissions', 'Права доступа', 200)
ON CONFLICT (module_key) DO NOTHING;

-- 8. Базовые пресеты для всех ролей — read для стандартных модулей
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete)
SELECT r.role, m.module_key, true, false, false
FROM (VALUES
  ('PM'), ('TO'), ('HEAD_PM'), ('HEAD_TO'),
  ('HR'), ('HR_MANAGER'), ('BUH'), ('PROC'),
  ('OFFICE_MANAGER'), ('CHIEF_ENGINEER'),
  ('DIRECTOR_GEN'), ('DIRECTOR_COMM'), ('DIRECTOR_DEV'),
  ('WAREHOUSE')
) AS r(role)
CROSS JOIN modules m
WHERE m.module_key IN ('tenders','works','estimates','invoices','notifications','calendar','chat_groups','customers')
ON CONFLICT (role, module_key) DO NOTHING;

-- Расширенные права для руководителей
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete)
VALUES
  ('DIRECTOR_GEN', 'users', true, true, true),
  ('DIRECTOR_GEN', 'permissions', true, true, false),
  ('DIRECTOR_GEN', 'settings', true, true, false),
  ('DIRECTOR_GEN', 'reports', true, true, false),
  ('HEAD_PM', 'works', true, true, false),
  ('HEAD_PM', 'tenders', true, true, false),
  ('HEAD_PM', 'tkp', true, true, false),
  ('HEAD_PM', 'estimates', true, true, false),
  ('HEAD_TO', 'tenders', true, true, false),
  ('HEAD_TO', 'works', true, true, false),
  ('PM', 'works', true, true, false),
  ('PM', 'tenders', true, true, false),
  ('PM', 'tkp', true, true, false),
  ('PM', 'pass_requests', true, true, false),
  ('PM', 'tmc_requests', true, true, false),
  ('TO', 'tenders', true, true, false),
  ('HR', 'staff', true, true, false),
  ('HR_MANAGER', 'staff', true, true, true),
  ('BUH', 'cash', true, true, false),
  ('BUH', 'invoices', true, true, false),
  ('PROC', 'tmc_requests', true, true, false),
  ('PROC', 'equipment', true, true, false),
  ('WAREHOUSE', 'equipment', true, true, false),
  ('WAREHOUSE', 'tmc_requests', true, true, false)
ON CONFLICT (role, module_key) DO UPDATE SET can_read = EXCLUDED.can_read, can_write = EXCLUDED.can_write, can_delete = EXCLUDED.can_delete;
