-- ═══════════════════════════════════════════════════════════════
-- V009: Исправление прав доступа и таблицы notifications
-- ═══════════════════════════════════════════════════════════════

-- 1. Добавить недостающие колонки в notifications (если их нет)
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS day_key VARCHAR(20);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedup_key TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link_hash TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id INTEGER;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS created_by INTEGER;

-- 2. Индексы для notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

-- 3. Выдать права пользователю asgard на ВСЕ таблицы
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO asgard;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO asgard;
GRANT USAGE ON SCHEMA public TO asgard;

-- 4. Права по умолчанию для будущих таблиц
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO asgard;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO asgard;

-- 5. Добавить права пользователям на основе их ролей (если не добавлены)
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, rp.module_key, rp.can_read, rp.can_write, rp.can_delete, u.id
FROM users u
JOIN role_presets rp ON rp.role = u.role
WHERE u.is_active = true
ON CONFLICT (user_id, module_key) DO UPDATE SET
  can_read = EXCLUDED.can_read,
  can_write = EXCLUDED.can_write,
  can_delete = EXCLUDED.can_delete;

-- 6. Для ADMIN дать все права на все модули
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, m.key, true, true, true, u.id
FROM users u
CROSS JOIN modules m
WHERE u.role = 'ADMIN' AND u.is_active = true
ON CONFLICT (user_id, module_key) DO UPDATE SET
  can_read = true, can_write = true, can_delete = true;

-- 7. Добавить недостающие модули (если их нет)
INSERT INTO modules (key, label, description, category, sort_order) VALUES
  ('home', 'Главная', 'Главная страница', 'general', 1),
  ('dashboard', 'Дашборд', 'Аналитика', 'general', 2),
  ('tenders', 'Тендеры', 'Управление тендерами', 'sales', 10),
  ('estimates', 'Просчёты', 'ТКП и просчёты', 'sales', 11),
  ('works', 'Работы', 'Контракты и работы', 'projects', 20),
  ('customers', 'Контрагенты', 'Клиенты и поставщики', 'sales', 12),
  ('personnel', 'Персонал', 'Сотрудники', 'hr', 40),
  ('finance', 'Финансы', 'Финансовые операции', 'finance', 30),
  ('calendar', 'Календарь', 'События и встречи', 'general', 5),
  ('notifications', 'Уведомления', 'Системные уведомления', 'system', 100),
  ('settings', 'Настройки', 'Настройки системы', 'system', 99),
  ('equipment', 'Оборудование', 'Склад оборудования', 'warehouse', 50),
  ('documents', 'Документы', 'Управление документами', 'general', 60),
  ('reports', 'Отчёты', 'Отчёты и аналитика', 'general', 70),
  ('chat', 'Чат', 'Внутренний чат', 'general', 80),
  ('todo', 'Задачи', 'Личные задачи', 'general', 6)
ON CONFLICT (key) DO NOTHING;

-- 8. Пресеты для всех ролей (базовые модули)
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  -- ADMIN получает всё автоматически через код
  -- PM
  ('PM', 'home', true, false, false),
  ('PM', 'tenders', true, true, false),
  ('PM', 'estimates', true, true, false),
  ('PM', 'works', true, true, false),
  ('PM', 'customers', true, true, false),
  ('PM', 'calendar', true, true, false),
  ('PM', 'notifications', true, true, false),
  ('PM', 'documents', true, true, false),
  ('PM', 'chat', true, true, false),
  ('PM', 'todo', true, true, true),
  ('PM', 'equipment', true, true, false),
  -- TO
  ('TO', 'home', true, false, false),
  ('TO', 'tenders', true, true, false),
  ('TO', 'estimates', true, true, false),
  ('TO', 'customers', true, true, false),
  ('TO', 'calendar', true, true, false),
  ('TO', 'notifications', true, true, false),
  ('TO', 'documents', true, true, false),
  ('TO', 'chat', true, true, false),
  ('TO', 'todo', true, true, true),
  -- HR
  ('HR', 'home', true, false, false),
  ('HR', 'personnel', true, true, true),
  ('HR', 'calendar', true, true, false),
  ('HR', 'notifications', true, true, false),
  ('HR', 'chat', true, true, false),
  ('HR', 'todo', true, true, true),
  -- BUH
  ('BUH', 'home', true, false, false),
  ('BUH', 'finance', true, true, false),
  ('BUH', 'works', true, false, false),
  ('BUH', 'calendar', true, true, false),
  ('BUH', 'notifications', true, true, false),
  ('BUH', 'chat', true, true, false),
  ('BUH', 'todo', true, true, true),
  -- OFFICE_MANAGER
  ('OFFICE_MANAGER', 'home', true, false, false),
  ('OFFICE_MANAGER', 'calendar', true, true, false),
  ('OFFICE_MANAGER', 'notifications', true, true, false),
  ('OFFICE_MANAGER', 'documents', true, true, false),
  ('OFFICE_MANAGER', 'chat', true, true, false),
  ('OFFICE_MANAGER', 'todo', true, true, true),
  -- WAREHOUSE
  ('WAREHOUSE', 'home', true, false, false),
  ('WAREHOUSE', 'equipment', true, true, false),
  ('WAREHOUSE', 'notifications', true, true, false),
  ('WAREHOUSE', 'chat', true, true, false),
  ('WAREHOUSE', 'todo', true, true, true),
  -- PROC
  ('PROC', 'home', true, false, false),
  ('PROC', 'equipment', true, true, false),
  ('PROC', 'notifications', true, true, false),
  ('PROC', 'chat', true, true, false),
  ('PROC', 'todo', true, true, true),
  -- Directors
  ('DIRECTOR_GEN', 'home', true, false, false),
  ('DIRECTOR_GEN', 'dashboard', true, true, false),
  ('DIRECTOR_GEN', 'tenders', true, true, true),
  ('DIRECTOR_GEN', 'estimates', true, true, true),
  ('DIRECTOR_GEN', 'works', true, true, true),
  ('DIRECTOR_GEN', 'customers', true, true, true),
  ('DIRECTOR_GEN', 'personnel', true, true, true),
  ('DIRECTOR_GEN', 'finance', true, true, true),
  ('DIRECTOR_GEN', 'calendar', true, true, true),
  ('DIRECTOR_GEN', 'notifications', true, true, true),
  ('DIRECTOR_GEN', 'settings', true, true, true),
  ('DIRECTOR_GEN', 'equipment', true, true, true),
  ('DIRECTOR_GEN', 'documents', true, true, true),
  ('DIRECTOR_GEN', 'reports', true, true, false),
  ('DIRECTOR_GEN', 'chat', true, true, false),
  ('DIRECTOR_GEN', 'todo', true, true, true),
  ('DIRECTOR_COMM', 'home', true, false, false),
  ('DIRECTOR_COMM', 'dashboard', true, true, false),
  ('DIRECTOR_COMM', 'tenders', true, true, false),
  ('DIRECTOR_COMM', 'estimates', true, true, false),
  ('DIRECTOR_COMM', 'works', true, true, false),
  ('DIRECTOR_COMM', 'customers', true, true, false),
  ('DIRECTOR_COMM', 'finance', true, true, false),
  ('DIRECTOR_COMM', 'calendar', true, true, false),
  ('DIRECTOR_COMM', 'notifications', true, true, false),
  ('DIRECTOR_COMM', 'chat', true, true, false),
  ('DIRECTOR_COMM', 'todo', true, true, true),
  ('DIRECTOR_DEV', 'home', true, false, false),
  ('DIRECTOR_DEV', 'dashboard', true, true, false),
  ('DIRECTOR_DEV', 'works', true, true, false),
  ('DIRECTOR_DEV', 'personnel', true, true, false),
  ('DIRECTOR_DEV', 'calendar', true, true, false),
  ('DIRECTOR_DEV', 'notifications', true, true, false),
  ('DIRECTOR_DEV', 'equipment', true, true, false),
  ('DIRECTOR_DEV', 'chat', true, true, false),
  ('DIRECTOR_DEV', 'todo', true, true, true)
ON CONFLICT (role, module_key) DO NOTHING;

-- 9. Обновить права всех пользователей
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, rp.module_key, rp.can_read, rp.can_write, rp.can_delete, u.id
FROM users u
JOIN role_presets rp ON rp.role = u.role
WHERE u.is_active = true
ON CONFLICT (user_id, module_key) DO UPDATE SET
  can_read = GREATEST(user_permissions.can_read, EXCLUDED.can_read),
  can_write = GREATEST(user_permissions.can_write, EXCLUDED.can_write),
  can_delete = GREATEST(user_permissions.can_delete, EXCLUDED.can_delete);
