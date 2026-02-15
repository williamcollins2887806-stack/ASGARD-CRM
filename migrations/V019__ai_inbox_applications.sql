-- ═══════════════════════════════════════════════════════════════
-- V019: AI Входящие заявки — inbox_applications + ai_analysis_log
-- Фаза 9: Автоматический анализ входящих писем с помощью ИИ
-- ═══════════════════════════════════════════════════════════════

-- 1. Таблица входящих заявок
CREATE TABLE IF NOT EXISTS inbox_applications (
  id SERIAL PRIMARY KEY,
  email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL,

  -- Источник
  source VARCHAR(50) DEFAULT 'email',
  source_email VARCHAR(255),
  source_name VARCHAR(255),
  subject TEXT,
  body_preview TEXT,

  -- AI-анализ
  ai_classification VARCHAR(50),
  ai_color VARCHAR(10) CHECK (ai_color IN ('green','yellow','red')),
  ai_summary TEXT,
  ai_recommendation TEXT,
  ai_work_type VARCHAR(100),
  ai_estimated_budget NUMERIC(15,2),
  ai_estimated_days INTEGER,
  ai_keywords TEXT[],
  ai_confidence NUMERIC(5,2),
  ai_raw_json JSONB,
  ai_analyzed_at TIMESTAMP,
  ai_model VARCHAR(100),

  -- Рабочая нагрузка на момент анализа
  workload_snapshot JSONB,

  -- Статус workflow
  status VARCHAR(30) DEFAULT 'new' CHECK (status IN ('new','ai_processed','under_review','accepted','rejected','archived')),

  -- Решение
  decision_by INTEGER REFERENCES users(id),
  decision_at TIMESTAMP,
  decision_notes TEXT,
  rejection_reason TEXT,

  -- Связи
  linked_tender_id INTEGER REFERENCES tenders(id),
  linked_work_id INTEGER REFERENCES works(id),

  -- Файлы
  attachment_count INTEGER DEFAULT 0,

  -- Мета
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Журнал AI-анализов
CREATE TABLE IF NOT EXISTS ai_analysis_log (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INTEGER NOT NULL,
  analysis_type VARCHAR(50) DEFAULT 'email_classification',

  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,

  model VARCHAR(100),
  provider VARCHAR(30),
  duration_ms INTEGER,

  input_preview TEXT,
  output_json JSONB,
  error TEXT,

  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 3. Индексы
CREATE INDEX IF NOT EXISTS idx_inbox_app_status ON inbox_applications(status);
CREATE INDEX IF NOT EXISTS idx_inbox_app_color ON inbox_applications(ai_color);
CREATE INDEX IF NOT EXISTS idx_inbox_app_email ON inbox_applications(email_id);
CREATE INDEX IF NOT EXISTS idx_inbox_app_created ON inbox_applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inbox_app_tender ON inbox_applications(linked_tender_id);
CREATE INDEX IF NOT EXISTS idx_ai_log_entity ON ai_analysis_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ai_log_created ON ai_analysis_log(created_at DESC);

-- 4. Регистрация модуля
INSERT INTO modules (key, label, description, category, icon, sort_order)
VALUES ('inbox_applications', 'Входящие заявки', 'AI-анализ входящих писем и заявок', 'comm', 'alerts', 60)
ON CONFLICT (key) DO NOTHING;

-- 5. Пресеты ролей
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('ADMIN', 'inbox_applications', true, true, true),
  ('DIRECTOR_GEN', 'inbox_applications', true, true, true),
  ('DIRECTOR_COMM', 'inbox_applications', true, true, true),
  ('DIRECTOR_DEV', 'inbox_applications', true, true, false),
  ('HEAD_TO', 'inbox_applications', true, true, false),
  ('TO', 'inbox_applications', true, false, false)
ON CONFLICT (role, module_key) DO NOTHING;

-- 6. Выдать права существующим пользователям
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, rp.module_key, rp.can_read, rp.can_write, rp.can_delete, u.id
FROM users u
JOIN role_presets rp ON rp.role = u.role
WHERE u.is_active = true
  AND rp.module_key = 'inbox_applications'
ON CONFLICT (user_id, module_key) DO NOTHING;
