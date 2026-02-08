-- ═══════════════════════════════════════════════════════════════
-- V010: Комплексный фикс всех модулей M2, M3 + chat_messages
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. ИСПРАВЛЕНИЕ chat_messages
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);

-- ═══════════════════════════════════════════════════════════════
-- 2. КАССА (M2) — Создание таблиц если не существуют
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cash_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_id INTEGER REFERENCES works(id),
  type VARCHAR(20) NOT NULL DEFAULT 'advance',
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  purpose TEXT NOT NULL,
  cover_letter TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'requested',
  director_id INTEGER REFERENCES users(id),
  director_comment TEXT,
  received_at TIMESTAMP,
  closed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_expenses (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES cash_requests(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  description TEXT NOT NULL,
  receipt_file VARCHAR(255),
  receipt_original_name VARCHAR(255),
  expense_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_returns (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES cash_requests(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  note TEXT,
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_messages (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES cash_requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_requests_user ON cash_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_requests_status ON cash_requests(status);
CREATE INDEX IF NOT EXISTS idx_cash_requests_work ON cash_requests(work_id);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_request ON cash_expenses(request_id);
CREATE INDEX IF NOT EXISTS idx_cash_returns_request ON cash_returns(request_id);
CREATE INDEX IF NOT EXISTS idx_cash_messages_request ON cash_messages(request_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. ЗАДАЧИ (M3) — Создание таблиц если не существуют
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES users(id),
  assignee_id INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  deadline TIMESTAMP,
  priority VARCHAR(20) DEFAULT 'normal',
  status VARCHAR(20) NOT NULL DEFAULT 'new',
  accepted_at TIMESTAMP,
  completed_at TIMESTAMP,
  files JSONB DEFAULT '[]',
  creator_comment TEXT,
  assignee_comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS todo_items (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text VARCHAR(500) NOT NULL,
  done BOOLEAN DEFAULT false,
  done_at TIMESTAMP,
  auto_delete_hours INTEGER DEFAULT 48,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_todo_user ON todo_items(user_id);
CREATE INDEX IF NOT EXISTS idx_todo_done ON todo_items(user_id, done);

-- ═══════════════════════════════════════════════════════════════
-- 4. РЕГИСТРАЦИЯ МОДУЛЕЙ
-- ═══════════════════════════════════════════════════════════════
INSERT INTO modules (key, label, description, category, icon, sort_order) VALUES
  ('cash',       'Касса',                'Авансовые отчёты и расчёты',  'finance', 'finances', 35),
  ('cash_admin', 'Касса (управление)',   'Согласование и контроль',     'finance', 'finances', 36),
  ('tasks',      'Задачи',               'Задачи от руководства',       'general', 'approvals', 8),
  ('tasks_admin','Управление задачами',  'Создание и контроль задач',   'general', 'approvals', 9),
  ('todo',       'Todo-список',          'Личный список дел',           'general', 'approvals', 10),
  ('users',      'Пользователи',         'Управление пользователями',   'admin',   'settings', 90)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 5. ПРЕСЕТЫ РОЛЕЙ — полный набор для всех модулей
-- ═══════════════════════════════════════════════════════════════
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  -- CASH module
  ('PM', 'cash', true, true, false),
  ('DIRECTOR_GEN', 'cash', true, true, true),
  ('DIRECTOR_GEN', 'cash_admin', true, true, true),
  ('DIRECTOR_COMM', 'cash', true, true, true),
  ('DIRECTOR_COMM', 'cash_admin', true, true, true),
  ('DIRECTOR_DEV', 'cash', true, true, true),
  ('DIRECTOR_DEV', 'cash_admin', true, true, true),
  ('BUH', 'cash', true, false, false),
  ('BUH', 'cash_admin', true, false, false),

  -- TASKS module
  ('PM', 'tasks', true, true, false),
  ('TO', 'tasks', true, true, false),
  ('HR', 'tasks', true, true, false),
  ('BUH', 'tasks', true, true, false),
  ('OFFICE_MANAGER', 'tasks', true, true, false),
  ('WAREHOUSE', 'tasks', true, true, false),
  ('PROC', 'tasks', true, true, false),
  ('DIRECTOR_GEN', 'tasks', true, true, true),
  ('DIRECTOR_GEN', 'tasks_admin', true, true, true),
  ('DIRECTOR_COMM', 'tasks', true, true, true),
  ('DIRECTOR_COMM', 'tasks_admin', true, true, true),
  ('DIRECTOR_DEV', 'tasks', true, true, true),
  ('DIRECTOR_DEV', 'tasks_admin', true, true, true),

  -- TODO module
  ('PM', 'todo', true, true, true),
  ('TO', 'todo', true, true, true),
  ('HR', 'todo', true, true, true),
  ('BUH', 'todo', true, true, true),
  ('OFFICE_MANAGER', 'todo', true, true, true),
  ('WAREHOUSE', 'todo', true, true, true),
  ('PROC', 'todo', true, true, true),
  ('DIRECTOR_GEN', 'todo', true, true, true),
  ('DIRECTOR_COMM', 'todo', true, true, true),
  ('DIRECTOR_DEV', 'todo', true, true, true),

  -- USERS module (only ADMIN)
  ('ADMIN', 'users', true, true, true)
ON CONFLICT (role, module_key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 6. ПРАВА ПОЛЬЗОВАТЕЛЕЙ — полный пересчёт
-- ═══════════════════════════════════════════════════════════════
-- Удаляем старые права для пересоздания
DELETE FROM user_permissions WHERE module_key IN ('cash', 'cash_admin', 'tasks', 'tasks_admin', 'todo', 'users');

-- Вставляем права на основе role_presets
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, rp.module_key, rp.can_read, rp.can_write, rp.can_delete, u.id
FROM users u
JOIN role_presets rp ON rp.role = u.role
WHERE u.is_active = true
ON CONFLICT (user_id, module_key) DO UPDATE SET
  can_read = EXCLUDED.can_read,
  can_write = EXCLUDED.can_write,
  can_delete = EXCLUDED.can_delete;

-- ADMIN получает все права на все модули
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, m.key, true, true, true, u.id
FROM users u
CROSS JOIN modules m
WHERE u.role = 'ADMIN' AND u.is_active = true
ON CONFLICT (user_id, module_key) DO UPDATE SET
  can_read = true,
  can_write = true,
  can_delete = true;

-- ═══════════════════════════════════════════════════════════════
-- 7. ПРАВА PostgreSQL
-- ═══════════════════════════════════════════════════════════════
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO asgard;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO asgard;
GRANT USAGE ON SCHEMA public TO asgard;

-- Дефолтные права для будущих таблиц
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO asgard;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO asgard;

-- ═══════════════════════════════════════════════════════════════
-- 8. Фикс employees.rating_avg — NULL → 0
-- ═══════════════════════════════════════════════════════════════
UPDATE employees SET rating_avg = 0 WHERE rating_avg IS NULL;
ALTER TABLE employees ALTER COLUMN rating_avg SET DEFAULT 0;
