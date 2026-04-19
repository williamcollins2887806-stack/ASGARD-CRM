-- V058: Отчёт согласования ТКП по просчёту
-- Таблицы: approval_comments, estimate_calculation_data
-- ALTER TABLE estimates: новые колонки для отчёта

-- ═══════════════════════════════════════════════════════════════
-- 1. Потоковые комментарии согласования
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS approval_comments (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  action VARCHAR(30),
  comment TEXT NOT NULL,
  version_no INTEGER,
  parent_id INTEGER REFERENCES approval_comments(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_approval_comments_entity
  ON approval_comments(entity_type, entity_id);

-- ═══════════════════════════════════════════════════════════════
-- 2. Детализация расчёта (6 блоков затрат)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS estimate_calculation_data (
  id SERIAL PRIMARY KEY,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL DEFAULT 1,

  -- 6 блоков затрат (JSONB — массивы позиций)
  personnel_json JSONB DEFAULT '[]',
  current_costs_json JSONB DEFAULT '[]',
  travel_json JSONB DEFAULT '[]',
  transport_json JSONB DEFAULT '[]',
  chemistry_json JSONB DEFAULT '[]',
  contingency_pct NUMERIC(5,2) DEFAULT 5,

  -- Мимир / склад / файлы
  mimir_suggestions JSONB,
  warehouse_check JSONB,
  files_parsed JSONB,

  -- Итоги (вычисляемые, кэшируются)
  subtotal NUMERIC(14,2),
  contingency_amount NUMERIC(14,2),
  total_cost NUMERIC(14,2),
  margin_pct NUMERIC(5,2),
  total_with_margin NUMERIC(14,2),

  -- Мета
  notes TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(estimate_id, version_no)
);

-- ═══════════════════════════════════════════════════════════════
-- 3. Новые колонки в estimates
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS current_version_no INTEGER DEFAULT 1;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS last_director_comment TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS director_id INTEGER REFERENCES users(id);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS sla_deadline TIMESTAMP;

-- Карточка объекта
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS object_description TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS object_city VARCHAR(100);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS object_distance_km INTEGER;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS work_start_date DATE;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS work_end_date DATE;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS crew_count INTEGER;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS work_days INTEGER;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS road_days INTEGER DEFAULT 2;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS markup_multiplier NUMERIC(3,1);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS markup_reason TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS analog_projects JSONB;
