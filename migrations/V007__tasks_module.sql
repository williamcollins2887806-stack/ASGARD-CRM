-- ═══════════════════════════════════════════════════════════════
-- V007: Индивидуальные задачи + Todo-список
-- ═══════════════════════════════════════════════════════════════

-- 1. Задачи от руководства
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  creator_id INTEGER NOT NULL REFERENCES users(id),       -- кто создал (директор)
  assignee_id INTEGER NOT NULL REFERENCES users(id),      -- кому назначена
  title VARCHAR(255) NOT NULL,
  description TEXT,
  deadline TIMESTAMP,                                      -- дедлайн
  priority VARCHAR(20) DEFAULT 'normal',                   -- 'low', 'normal', 'high', 'urgent'
  status VARCHAR(20) NOT NULL DEFAULT 'new',               -- workflow: new → accepted → in_progress → done / overdue
  accepted_at TIMESTAMP,                                   -- когда сотрудник принял
  completed_at TIMESTAMP,                                  -- когда выполнил
  files JSONB DEFAULT '[]',                                -- [{filename, original_name, uploaded_at}]
  creator_comment TEXT,                                     -- доп.инструкции от создателя
  assignee_comment TEXT,                                    -- комментарий исполнителя при завершении
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Личный todo-список
CREATE TABLE IF NOT EXISTS todo_items (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text VARCHAR(500) NOT NULL,
  done BOOLEAN DEFAULT false,
  done_at TIMESTAMP,                                       -- когда отметили выполненным
  auto_delete_hours INTEGER DEFAULT 48,                    -- через сколько часов удалить после выполнения
  sort_order INTEGER DEFAULT 0,                            -- порядок в списке
  created_at TIMESTAMP DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline ON tasks(deadline);
CREATE INDEX IF NOT EXISTS idx_todo_user ON todo_items(user_id);
CREATE INDEX IF NOT EXISTS idx_todo_done ON todo_items(user_id, done);

-- 3. Регистрация модулей в справочнике M1
INSERT INTO modules (key, label, description, category, icon, sort_order)
VALUES
  ('tasks',      'Задачи',       'Задачи от руководства',       'general', 'approvals', 8),
  ('tasks_admin','Управление задачами', 'Создание и контроль задач', 'general', 'approvals', 9),
  ('todo',       'Todo-список',  'Личный список дел',           'general', 'approvals', 10)
ON CONFLICT (key) DO NOTHING;

-- 4. Пресеты ролей
-- Все сотрудники видят свои задачи и ведут todo
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  -- tasks: все читают (свои), только write для принятия/завершения
  ('PM', 'tasks', true, true, false),
  ('TO', 'tasks', true, true, false),
  ('HR', 'tasks', true, true, false),
  ('BUH', 'tasks', true, true, false),
  ('OFFICE_MANAGER', 'tasks', true, true, false),
  ('WAREHOUSE', 'tasks', true, true, false),
  ('PROC', 'tasks', true, true, false),
  -- Директора: полный доступ к задачам + управление
  ('DIRECTOR_GEN', 'tasks', true, true, true),
  ('DIRECTOR_GEN', 'tasks_admin', true, true, true),
  ('DIRECTOR_COMM', 'tasks', true, true, true),
  ('DIRECTOR_COMM', 'tasks_admin', true, true, true),
  ('DIRECTOR_DEV', 'tasks', true, true, true),
  ('DIRECTOR_DEV', 'tasks_admin', true, true, true),
  -- todo: все ведут свой список
  ('PM', 'todo', true, true, true),
  ('TO', 'todo', true, true, true),
  ('HR', 'todo', true, true, true),
  ('BUH', 'todo', true, true, true),
  ('OFFICE_MANAGER', 'todo', true, true, true),
  ('WAREHOUSE', 'todo', true, true, true),
  ('PROC', 'todo', true, true, true),
  ('DIRECTOR_GEN', 'todo', true, true, true),
  ('DIRECTOR_COMM', 'todo', true, true, true),
  ('DIRECTOR_DEV', 'todo', true, true, true)
ON CONFLICT (role, module_key) DO NOTHING;

-- 5. Проставить пермишены существующим пользователям
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, rp.module_key, rp.can_read, rp.can_write, rp.can_delete, u.id
FROM users u
JOIN role_presets rp ON rp.role = u.role
WHERE u.is_active = true
  AND rp.module_key IN ('tasks', 'tasks_admin', 'todo')
ON CONFLICT (user_id, module_key) DO NOTHING;
