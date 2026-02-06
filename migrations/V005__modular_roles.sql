-- ═══════════════════════════════════════════════════════════════
-- V005: Модульные роли — permission-based access control
-- ═══════════════════════════════════════════════════════════════

-- 1. Справочник модулей CRM
CREATE TABLE IF NOT EXISTS modules (
  id SERIAL PRIMARY KEY,
  key VARCHAR(50) UNIQUE NOT NULL,          -- например: 'tenders', 'finances', 'warehouse'
  label VARCHAR(100) NOT NULL,               -- 'Сага Тендеров'
  description TEXT,                          -- 'Реестр тендеров и воронка продаж'
  category VARCHAR(50) DEFAULT 'general',    -- группировка: general, finance, hr, project, system
  icon VARCHAR(50),                          -- иконка для UI (из существующих AsgardUI иконок)
  sort_order INTEGER DEFAULT 100,            -- порядок в списке
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Права пользователей на модули
CREATE TABLE IF NOT EXISTS user_permissions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_key VARCHAR(50) NOT NULL,           -- ссылка на modules.key
  can_read BOOLEAN DEFAULT false,
  can_write BOOLEAN DEFAULT false,            -- создание и редактирование
  can_delete BOOLEAN DEFAULT false,
  granted_by INTEGER REFERENCES users(id),    -- кто выдал
  granted_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, module_key)
);

-- 3. Пресеты ролей (какие пермишены даёт каждая роль по умолчанию)
CREATE TABLE IF NOT EXISTS role_presets (
  id SERIAL PRIMARY KEY,
  role VARCHAR(50) NOT NULL,                 -- 'PM', 'TO', etc.
  module_key VARCHAR(50) NOT NULL,
  can_read BOOLEAN DEFAULT false,
  can_write BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  UNIQUE(role, module_key)
);

-- 4. Настройки меню пользователя (скрытие / порядок вкладок)
CREATE TABLE IF NOT EXISTS user_menu_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  hidden_routes JSONB DEFAULT '[]',          -- ["#/birthdays", "#/correspondence"]
  route_order JSONB DEFAULT '[]',            -- ["#/tenders", "#/dashboard", ...]
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_user_permissions_user ON user_permissions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_permissions_module ON user_permissions(module_key);
CREATE INDEX IF NOT EXISTS idx_role_presets_role ON role_presets(role);

-- ═══════════════════════════════════════════════════════════════
-- ЗАПОЛНЕНИЕ СПРАВОЧНИКА МОДУЛЕЙ
-- ═══════════════════════════════════════════════════════════════

INSERT INTO modules (key, label, description, category, icon, sort_order) VALUES
  -- Общие
  ('home',             'Зал Ярла',              'Главная страница',                     'general',  'home',          1),
  ('calendar',         'Календарь встреч',       'Совещания и события',                  'general',  'schedule',      2),
  ('birthdays',        'Дни рождения',           'Офисный календарь ДР',                 'general',  'birthdays',     3),
  ('alerts',           'Уведомления',            'События и ответы',                     'general',  'alerts',        4),
  ('office_schedule',  'График офиса',           'Статусы по дням',                      'general',  'schedule',      5),
  ('chat',             'Чат дружины',            'Общение и согласования',               'general',  'correspondence',6),
  ('my_dashboard',     'Мой дашборд',            'Настраиваемые виджеты',                'general',  'dashboard',     7),

  -- Тендеры
  ('tenders',          'Сага Тендеров',          'Реестр тендеров',                      'tenders',  'tenders',      10),
  ('funnel',           'Воронка продаж',         'Канбан тендеров',                      'tenders',  'tenders',      11),
  ('customers',        'Контрагенты',            'Справочник организаций',               'tenders',  'customers',    12),

  -- Проекты
  ('pm_calcs',         'Просчёты РП',            'Inbox РП — расчёты',                   'project',  'pmcalcs',      20),
  ('pm_works',         'Работы РП',              'Проекты РП',                           'project',  'pmworks',      21),
  ('approvals',        'Согласование',           'Решения Ярла',                         'project',  'approvals',    22),
  ('bonus_approval',   'Согласование премий',    'Премии рабочим',                       'project',  'approvals',    23),
  ('all_works',        'Свод Контрактов',        'Все работы (обзор)',                    'project',  'allworks',     24),
  ('all_estimates',    'Свод Расчётов',          'Все просчёты (обзор)',                  'project',  'allestimates', 25),
  ('gantt',            'Гантт',                  'Диаграммы работ и просчётов',          'project',  'ganttworks',   26),
  ('proc_requests',    'Заявки закупок',         'Закупки',                              'project',  'approvals',    27),

  -- Финансы
  ('finances',         'Финансы',                'Аналитика и реестр расходов',           'finance',  'finances',     30),
  ('invoices',         'Счета и оплаты',         'Выставление и отслеживание',           'finance',  'finances',     31),
  ('acts',             'Акты',                   'Акты выполненных работ',               'finance',  'buh',          32),
  ('buh_registry',     'Реестр расходов',        'Бухгалтерский реестр',                 'finance',  'finances',     33),
  ('office_expenses',  'Офисные расходы',        'Управление и согласование',            'finance',  'office',       34),

  -- HR
  ('personnel',        'Персонал',               'Дружина — сотрудники',                 'hr',       'workers',      40),
  ('hr_rating',        'Рейтинг Дружины',        'Оценки и средний балл',                'hr',       'rating',       41),
  ('workers_schedule', 'График рабочих',         'Бронь и доступность',                  'hr',       'workers',      42),
  ('hr_requests',      'Заявки персонала',       'HR-заявки',                            'hr',       'workers',      43),
  ('permits',          'Разрешения и допуски',   'Сроки действия, уведомления',          'hr',       'workers',      44),
  ('travel',           'Жильё и билеты',         'Проживание и транспорт',               'hr',       'travel',       45),

  -- Офис
  ('correspondence',   'Корреспонденция',        'Входящие и исходящие',                 'office',   'correspondence',50),
  ('contracts',        'Реестр договоров',       'Договора поставщиков и покупателей',    'office',   'proxies',      51),
  ('seals',            'Реестр печатей',         'Учёт и передача печатей',              'office',   'proxies',      52),
  ('proxies',          'Доверенности',           '7 шаблонов документов',                'office',   'proxies',      53),

  -- Аналитика
  ('dashboard',        'Дашборд руководителя',   'Сводная аналитика',                    'analytics','dashboard',    60),
  ('analytics',        'Аналитика Ярла',         'KPI работ и денег',                    'analytics','kpiworks',     61),

  -- Склад
  ('warehouse',        'Склад ТМЦ',             'Оборудование и инструменты',            'warehouse','backup',       70),
  ('my_equipment',     'Моё оборудование',       'Выданное мне',                         'warehouse','pmworks',      71),

  -- Система
  ('settings',         'Настройки',              'Кузница Настроек',                     'system',   'settings',     90),
  ('users_admin',      'Управление пользователями','Создание и редактирование',           'system',   'requests',     91),
  ('backup',           'Резервное копирование',  'Камень Хроник',                        'system',   'backup',       92),
  ('diag',             'Диагностика',            'Версия, база, self-test',              'system',   'diag',         93),
  ('telegram_admin',   'Telegram',               'Настройка уведомлений',                'system',   'alerts',       94),
  ('sync',             'PostgreSQL Sync',        'Синхронизация',                        'system',   'backup',       95)
ON CONFLICT (key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- ЗАПОЛНЕНИЕ ПРЕСЕТОВ РОЛЕЙ
-- Каждая строка = "роль X получает доступ к модулю Y"
-- ═══════════════════════════════════════════════════════════════

-- ADMIN получает ВСЁ (обрабатывается кодом, но для полноты вносим)
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete)
SELECT 'ADMIN', key, true, true, true FROM modules
ON CONFLICT (role, module_key) DO NOTHING;

-- TO (Тендерный специалист)
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('TO', 'home', true, false, false),
  ('TO', 'calendar', true, true, false),
  ('TO', 'birthdays', true, false, false),
  ('TO', 'alerts', true, true, false),
  ('TO', 'office_schedule', true, false, false),
  ('TO', 'chat', true, true, false),
  ('TO', 'tenders', true, true, false),
  ('TO', 'funnel', true, true, false),
  ('TO', 'customers', true, true, false),
  ('TO', 'permits', true, true, false),
  ('TO', 'personnel', true, false, false),
  ('TO', 'warehouse', true, false, false),
  ('TO', 'my_dashboard', true, true, false)
ON CONFLICT (role, module_key) DO NOTHING;

-- PM (Руководитель проекта)
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('PM', 'home', true, false, false),
  ('PM', 'calendar', true, true, false),
  ('PM', 'birthdays', true, false, false),
  ('PM', 'alerts', true, true, false),
  ('PM', 'office_schedule', true, false, false),
  ('PM', 'chat', true, true, false),
  ('PM', 'customers', true, true, false),
  ('PM', 'pm_calcs', true, true, false),
  ('PM', 'pm_works', true, true, false),
  ('PM', 'bonus_approval', true, true, false),
  ('PM', 'invoices', true, true, false),
  ('PM', 'acts', true, true, false),
  ('PM', 'travel', true, true, false),
  ('PM', 'gantt', true, false, false),
  ('PM', 'warehouse', true, false, false),
  ('PM', 'my_equipment', true, false, false),
  ('PM', 'my_dashboard', true, true, false),
  ('PM', 'personnel', true, false, false),
  ('PM', 'permits', true, false, false)
ON CONFLICT (role, module_key) DO NOTHING;

-- DIRECTOR_GEN / DIRECTOR_COMM / DIRECTOR_DEV — почти всё, кроме system
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete)
SELECT r.role, m.key, true, true,
  CASE WHEN m.category = 'system' THEN false ELSE true END
FROM (VALUES ('DIRECTOR_GEN'), ('DIRECTOR_COMM'), ('DIRECTOR_DEV')) r(role)
CROSS JOIN modules m
WHERE m.category != 'system' OR m.key IN ('settings', 'users_admin')
ON CONFLICT (role, module_key) DO NOTHING;

-- BUH (Бухгалтер)
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('BUH', 'home', true, false, false),
  ('BUH', 'calendar', true, true, false),
  ('BUH', 'birthdays', true, false, false),
  ('BUH', 'alerts', true, true, false),
  ('BUH', 'office_schedule', true, false, false),
  ('BUH', 'chat', true, true, false),
  ('BUH', 'finances', true, true, false),
  ('BUH', 'invoices', true, true, false),
  ('BUH', 'acts', true, true, false),
  ('BUH', 'buh_registry', true, true, false),
  ('BUH', 'contracts', true, true, false),
  ('BUH', 'my_dashboard', true, true, false),
  ('BUH', 'warehouse', true, false, false)
ON CONFLICT (role, module_key) DO NOTHING;

-- HR
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('HR', 'home', true, false, false),
  ('HR', 'calendar', true, true, false),
  ('HR', 'birthdays', true, false, false),
  ('HR', 'alerts', true, true, false),
  ('HR', 'office_schedule', true, false, false),
  ('HR', 'chat', true, true, false),
  ('HR', 'personnel', true, true, true),
  ('HR', 'hr_rating', true, true, false),
  ('HR', 'workers_schedule', true, true, false),
  ('HR', 'hr_requests', true, true, false),
  ('HR', 'permits', true, true, false),
  ('HR', 'travel', true, true, false),
  ('HR', 'warehouse', true, false, false),
  ('HR', 'my_dashboard', true, true, false),
  ('HR', 'pm_calcs', true, true, false),
  ('HR', 'pm_works', true, true, false)
ON CONFLICT (role, module_key) DO NOTHING;

-- OFFICE_MANAGER
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('OFFICE_MANAGER', 'home', true, false, false),
  ('OFFICE_MANAGER', 'calendar', true, true, false),
  ('OFFICE_MANAGER', 'birthdays', true, false, false),
  ('OFFICE_MANAGER', 'alerts', true, true, false),
  ('OFFICE_MANAGER', 'office_schedule', true, false, false),
  ('OFFICE_MANAGER', 'chat', true, true, false),
  ('OFFICE_MANAGER', 'office_expenses', true, true, false),
  ('OFFICE_MANAGER', 'correspondence', true, true, false),
  ('OFFICE_MANAGER', 'contracts', true, true, false),
  ('OFFICE_MANAGER', 'seals', true, true, false),
  ('OFFICE_MANAGER', 'proxies', true, true, false),
  ('OFFICE_MANAGER', 'travel', true, true, false),
  ('OFFICE_MANAGER', 'warehouse', true, false, false),
  ('OFFICE_MANAGER', 'my_dashboard', true, true, false)
ON CONFLICT (role, module_key) DO NOTHING;

-- WAREHOUSE (Кладовщик)
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('WAREHOUSE', 'home', true, false, false),
  ('WAREHOUSE', 'alerts', true, true, false),
  ('WAREHOUSE', 'office_schedule', true, false, false),
  ('WAREHOUSE', 'warehouse', true, true, true),
  ('WAREHOUSE', 'my_equipment', true, true, false),
  ('WAREHOUSE', 'birthdays', true, false, false)
ON CONFLICT (role, module_key) DO NOTHING;

-- PROC (Закупщик)
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('PROC', 'home', true, false, false),
  ('PROC', 'alerts', true, true, false),
  ('PROC', 'office_schedule', true, false, false),
  ('PROC', 'birthdays', true, false, false),
  ('PROC', 'chat', true, true, false),
  ('PROC', 'proc_requests', true, true, false),
  ('PROC', 'personnel', true, false, false),
  ('PROC', 'warehouse', true, false, false),
  ('PROC', 'my_dashboard', true, true, false)
ON CONFLICT (role, module_key) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- ИНИЦИАЛИЗАЦИЯ: Проставить пермишены всем существующим пользователям
-- на основе их текущей роли
-- ═══════════════════════════════════════════════════════════════

INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, rp.module_key, rp.can_read, rp.can_write, rp.can_delete, u.id
FROM users u
JOIN role_presets rp ON rp.role = u.role
WHERE u.is_active = true
ON CONFLICT (user_id, module_key) DO NOTHING;
