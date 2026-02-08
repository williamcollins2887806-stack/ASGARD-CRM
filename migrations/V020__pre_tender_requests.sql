-- ═══════════════════════════════════════════════════════════════
-- V020: Предварительные заявки (pre_tender_requests)
-- Фаза 9, Шаг 10: Промежуточный этап между входящей почтой и тендерами
-- ═══════════════════════════════════════════════════════════════

-- 1. Таблица предварительных заявок
CREATE TABLE IF NOT EXISTS pre_tender_requests (
  id SERIAL PRIMARY KEY,

  -- Источник
  email_id INTEGER UNIQUE REFERENCES emails(id) ON DELETE SET NULL,
  source_type VARCHAR(30) NOT NULL DEFAULT 'email'
    CHECK (source_type IN ('email', 'manual', 'platform')),

  -- Извлечённые данные (из письма + AI)
  customer_name VARCHAR(500),
  customer_inn VARCHAR(20),
  customer_email VARCHAR(255),
  contact_person VARCHAR(255),
  contact_phone VARCHAR(100),

  work_description TEXT,
  work_location VARCHAR(500),
  work_deadline DATE,
  estimated_sum NUMERIC(14,2),

  -- AI-анализ
  ai_summary TEXT,
  ai_color VARCHAR(20) DEFAULT 'yellow'
    CHECK (ai_color IN ('green', 'yellow', 'red', 'gray')),
  ai_recommendation TEXT,
  ai_work_match_score INTEGER DEFAULT 50
    CHECK (ai_work_match_score BETWEEN 0 AND 100),
  ai_workload_warning TEXT,
  ai_processed_at TIMESTAMP,

  -- Вложения
  has_documents BOOLEAN DEFAULT false,
  documents_summary TEXT,
  manual_documents JSONB DEFAULT '[]',

  -- Workflow
  status VARCHAR(30) NOT NULL DEFAULT 'new'
    CHECK (status IN (
      'new',
      'in_review',
      'need_docs',
      'accepted',
      'rejected',
      'expired'
    )),
  decision_by INTEGER REFERENCES users(id),
  decision_at TIMESTAMP,
  decision_comment TEXT,
  reject_reason TEXT,

  -- Результат
  created_tender_id INTEGER,
  response_email_id INTEGER,

  -- Метаданные
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. Индексы
CREATE INDEX IF NOT EXISTS idx_pre_tender_status ON pre_tender_requests(status);
CREATE INDEX IF NOT EXISTS idx_pre_tender_email ON pre_tender_requests(email_id);
CREATE INDEX IF NOT EXISTS idx_pre_tender_color ON pre_tender_requests(ai_color);
CREATE INDEX IF NOT EXISTS idx_pre_tender_date ON pre_tender_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pre_tender_tender ON pre_tender_requests(created_tender_id);

-- 3. Обратная ссылка в emails
ALTER TABLE emails ADD COLUMN IF NOT EXISTS pre_tender_id INTEGER;

-- 4. Регистрация модуля
INSERT INTO modules (key, label, description, category, icon, sort_order)
VALUES ('pre_tenders', 'Предварительные заявки', 'Заявки из входящей почты для принятия/отклонения', 'tenders', 'alerts', 15)
ON CONFLICT (key) DO NOTHING;

-- 5. Пресеты ролей
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('ADMIN', 'pre_tenders', true, true, true),
  ('DIRECTOR_GEN', 'pre_tenders', true, true, true),
  ('DIRECTOR_COMM', 'pre_tenders', true, true, true),
  ('DIRECTOR_DEV', 'pre_tenders', true, true, false),
  ('HEAD_TO', 'pre_tenders', true, true, false),
  ('TO', 'pre_tenders', true, false, false)
ON CONFLICT (role, module_key) DO NOTHING;

-- 6. Выдать права
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete, granted_by)
SELECT u.id, rp.module_key, rp.can_read, rp.can_write, rp.can_delete, u.id
FROM users u
JOIN role_presets rp ON rp.role = u.role
WHERE u.is_active = true
  AND rp.module_key = 'pre_tenders'
ON CONFLICT (user_id, module_key) DO NOTHING;
