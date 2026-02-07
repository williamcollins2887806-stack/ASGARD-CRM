-- ═══════════════════════════════════════════════════════════════
-- V011: ФАЗА 2 — Коммуникации и Задачи
-- M3 (Групповые чаты) + M4 (Канбан-доска) + M5 (Совещания)
-- ═══════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════
-- 1. РАСШИРЕНИЕ ТАБЛИЦЫ CHATS (Групповые чаты)
-- ═══════════════════════════════════════════════════════════════

-- Добавляем новые поля для групповых чатов
ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_group BOOLEAN DEFAULT false;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS avatar VARCHAR(255);
ALTER TABLE chats ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS is_readonly BOOLEAN DEFAULT false;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMP;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS message_count INTEGER DEFAULT 0;

-- Индексы для чатов
CREATE INDEX IF NOT EXISTS idx_chats_is_group ON chats(is_group);
CREATE INDEX IF NOT EXISTS idx_chats_archived ON chats(archived_at);
CREATE INDEX IF NOT EXISTS idx_chats_last_message ON chats(last_message_at DESC);

-- ═══════════════════════════════════════════════════════════════
-- 2. УЧАСТНИКИ ГРУППОВЫХ ЧАТОВ
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chat_group_members (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member', -- 'owner', 'admin', 'member'
  muted_until TIMESTAMP,             -- заглушен до
  last_read_at TIMESTAMP,            -- последнее прочтение
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_group_members_chat ON chat_group_members(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_group_members_user ON chat_group_members(user_id);

-- ═══════════════════════════════════════════════════════════════
-- 3. ВЛОЖЕНИЯ ЧАТОВ
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS chat_attachments (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
  filename VARCHAR(255) NOT NULL,
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100),
  size_bytes INTEGER,
  uploaded_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_attachments_message ON chat_attachments(message_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. РАСШИРЕНИЕ chat_messages ДЛЯ ГРУППОВЫХ ЧАТОВ
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reply_to_id INTEGER REFERENCES chat_messages(id);
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS reactions JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_chat_messages_reply ON chat_messages(reply_to_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_id ON chat_messages(chat_id);

-- ═══════════════════════════════════════════════════════════════
-- 5. РАСШИРЕНИЕ TASKS ДЛЯ КАНБАН-ДОСКИ
-- ═══════════════════════════════════════════════════════════════

-- Добавляем Канбан-колонки и порядок
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kanban_column VARCHAR(20) DEFAULT 'new';
-- Колонки: 'new', 'in_progress', 'review', 'done'
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS kanban_position INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP;
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS acknowledged_by INTEGER REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS work_id INTEGER REFERENCES works(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tender_id INTEGER REFERENCES tenders(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS parent_task_id INTEGER REFERENCES tasks(id);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS estimated_hours NUMERIC(6,2);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS actual_hours NUMERIC(6,2);
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]';

-- Индексы для Канбан
CREATE INDEX IF NOT EXISTS idx_tasks_kanban ON tasks(kanban_column, kanban_position);
CREATE INDEX IF NOT EXISTS idx_tasks_work ON tasks(work_id);
CREATE INDEX IF NOT EXISTS idx_tasks_tender ON tasks(tender_id);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_acknowledged ON tasks(acknowledged_at);

-- ═══════════════════════════════════════════════════════════════
-- 6. КОММЕНТАРИИ К ЗАДАЧАМ
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS task_comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  attachments JSONB DEFAULT '[]',
  is_system BOOLEAN DEFAULT false, -- системный комментарий (изменение статуса)
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task ON task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_user ON task_comments(user_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_created ON task_comments(created_at);

-- ═══════════════════════════════════════════════════════════════
-- 7. НАБЛЮДАТЕЛИ ЗАДАЧ
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS task_watchers (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_watchers_task ON task_watchers(task_id);
CREATE INDEX IF NOT EXISTS idx_task_watchers_user ON task_watchers(user_id);

-- ═══════════════════════════════════════════════════════════════
-- 8. СОВЕЩАНИЯ
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS meetings (
  id SERIAL PRIMARY KEY,
  organizer_id INTEGER NOT NULL REFERENCES users(id),
  title VARCHAR(255) NOT NULL,
  description TEXT,
  location VARCHAR(255),               -- место проведения / ссылка на конференцию
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP,
  is_recurring BOOLEAN DEFAULT false,
  recurrence_rule TEXT,                -- iCal RRULE формат (опционально)
  status VARCHAR(20) DEFAULT 'scheduled', -- 'scheduled', 'in_progress', 'completed', 'cancelled'
  agenda TEXT,                         -- повестка дня
  minutes TEXT,                        -- протокол совещания
  minutes_author_id INTEGER REFERENCES users(id),
  minutes_approved_at TIMESTAMP,
  work_id INTEGER REFERENCES works(id),
  tender_id INTEGER REFERENCES tenders(id),
  notify_before_minutes INTEGER DEFAULT 15, -- уведомление за N минут
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meetings_organizer ON meetings(organizer_id);
CREATE INDEX IF NOT EXISTS idx_meetings_start ON meetings(start_time);
CREATE INDEX IF NOT EXISTS idx_meetings_status ON meetings(status);
CREATE INDEX IF NOT EXISTS idx_meetings_work ON meetings(work_id);
CREATE INDEX IF NOT EXISTS idx_meetings_tender ON meetings(tender_id);

-- ═══════════════════════════════════════════════════════════════
-- 9. УЧАСТНИКИ СОВЕЩАНИЙ
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS meeting_participants (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rsvp_status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'accepted', 'declined', 'tentative'
  rsvp_comment TEXT,
  attended BOOLEAN,                     -- фактически присутствовал
  notified_at TIMESTAMP,
  reminder_sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(meeting_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_user ON meeting_participants(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_rsvp ON meeting_participants(rsvp_status);

-- ═══════════════════════════════════════════════════════════════
-- 10. ПРОТОКОЛЫ СОВЕЩАНИЙ (расширенная структура)
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS meeting_minutes (
  id SERIAL PRIMARY KEY,
  meeting_id INTEGER NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  item_order INTEGER DEFAULT 0,
  item_type VARCHAR(20) DEFAULT 'note', -- 'note', 'decision', 'action', 'question'
  content TEXT NOT NULL,
  responsible_user_id INTEGER REFERENCES users(id),
  deadline TIMESTAMP,
  task_id INTEGER REFERENCES tasks(id), -- связанная задача (если создана)
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_meeting_minutes_meeting ON meeting_minutes(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_responsible ON meeting_minutes(responsible_user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_task ON meeting_minutes(task_id);

-- ═══════════════════════════════════════════════════════════════
-- 11. РЕГИСТРАЦИЯ МОДУЛЕЙ
-- ═══════════════════════════════════════════════════════════════

INSERT INTO modules (key, label, description, category, icon, sort_order) VALUES
  ('chat_groups',   'Групповые чаты',   'Групповые чаты команды',          'communications', 'chat',      45),
  ('kanban',        'Канбан-доска',     'Визуальное управление задачами',  'general',        'approvals', 11),
  ('meetings',      'Совещания',        'Планирование и протоколирование', 'communications', 'approvals', 46),
  ('meetings_admin','Совещания (упр.)', 'Управление совещаниями',          'communications', 'approvals', 47)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 12. ПРЕСЕТЫ РОЛЕЙ ДЛЯ НОВЫХ МОДУЛЕЙ
-- ═══════════════════════════════════════════════════════════════

INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  -- CHAT_GROUPS: все могут читать и писать
  ('PM', 'chat_groups', true, true, false),
  ('TO', 'chat_groups', true, true, false),
  ('HR', 'chat_groups', true, true, false),
  ('BUH', 'chat_groups', true, true, false),
  ('OFFICE_MANAGER', 'chat_groups', true, true, false),
  ('WAREHOUSE', 'chat_groups', true, true, false),
  ('PROC', 'chat_groups', true, true, false),
  ('DIRECTOR_GEN', 'chat_groups', true, true, true),
  ('DIRECTOR_COMM', 'chat_groups', true, true, true),
  ('DIRECTOR_DEV', 'chat_groups', true, true, true),

  -- KANBAN: все видят, только назначенные могут двигать
  ('PM', 'kanban', true, true, false),
  ('TO', 'kanban', true, true, false),
  ('HR', 'kanban', true, true, false),
  ('BUH', 'kanban', true, true, false),
  ('OFFICE_MANAGER', 'kanban', true, true, false),
  ('WAREHOUSE', 'kanban', true, true, false),
  ('PROC', 'kanban', true, true, false),
  ('DIRECTOR_GEN', 'kanban', true, true, true),
  ('DIRECTOR_COMM', 'kanban', true, true, true),
  ('DIRECTOR_DEV', 'kanban', true, true, true),

  -- MEETINGS: все могут читать, директора полный доступ
  ('PM', 'meetings', true, true, false),
  ('TO', 'meetings', true, true, false),
  ('HR', 'meetings', true, true, false),
  ('BUH', 'meetings', true, true, false),
  ('OFFICE_MANAGER', 'meetings', true, true, false),
  ('WAREHOUSE', 'meetings', true, true, false),
  ('PROC', 'meetings', true, true, false),
  ('DIRECTOR_GEN', 'meetings', true, true, true),
  ('DIRECTOR_GEN', 'meetings_admin', true, true, true),
  ('DIRECTOR_COMM', 'meetings', true, true, true),
  ('DIRECTOR_COMM', 'meetings_admin', true, true, true),
  ('DIRECTOR_DEV', 'meetings', true, true, true),
  ('DIRECTOR_DEV', 'meetings_admin', true, true, true)
ON CONFLICT (role, module_key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 13. ПРАВА ПОЛЬЗОВАТЕЛЕЙ — добавление для новых модулей
-- ═══════════════════════════════════════════════════════════════

INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, rp.module_key, rp.can_read, rp.can_write, rp.can_delete, u.id
FROM users u
JOIN role_presets rp ON rp.role = u.role
WHERE u.is_active = true
  AND rp.module_key IN ('chat_groups', 'kanban', 'meetings', 'meetings_admin')
ON CONFLICT (user_id, module_key) DO UPDATE SET
  can_read = EXCLUDED.can_read,
  can_write = EXCLUDED.can_write,
  can_delete = EXCLUDED.can_delete;

-- ADMIN получает все права
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, m.key, true, true, true, u.id
FROM users u
CROSS JOIN modules m
WHERE u.role = 'ADMIN' AND u.is_active = true
  AND m.key IN ('chat_groups', 'kanban', 'meetings', 'meetings_admin')
ON CONFLICT (user_id, module_key) DO UPDATE SET
  can_read = true,
  can_write = true,
  can_delete = true;

-- ═══════════════════════════════════════════════════════════════
-- 14. ОБНОВЛЕНИЕ ПРАВ PostgreSQL
-- ═══════════════════════════════════════════════════════════════

GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO asgard;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO asgard;
