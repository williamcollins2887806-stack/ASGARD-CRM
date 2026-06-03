-- ═══════════════════════════════════════════════════════════════════════════
-- HR Module v2 — Сессия 1, Шаг 1, Волна 2
-- V142: Расширение staff_requests v2 — позиции, назначения, статусы
--
-- Старый status оставляем для обратной совместимости, новый код читает status_v2.
-- ═══════════════════════════════════════════════════════════════════════════

-- Новые колонки staff_requests
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS work_description TEXT;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS work_conditions JSONB DEFAULT '{}';
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS hr_user_id INTEGER REFERENCES users(id);
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS taken_at TIMESTAMPTZ;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS sent_to_pm_at TIMESTAMPTZ;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS added_to_crew_at TIMESTAMPTZ;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS is_additional BOOLEAN DEFAULT false;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS parent_request_id INTEGER REFERENCES staff_requests(id);

-- Позиции в заявке (роли + счётчики)
CREATE TABLE IF NOT EXISTS staff_request_positions (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES staff_requests(id) ON DELETE CASCADE,
  role_key VARCHAR(50) NOT NULL,
  role_label VARCHAR(100) NOT NULL,
  required_count INTEGER NOT NULL DEFAULT 0,
  filled_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_srp_request ON staff_request_positions(request_id);

-- Назначения рабочих в заявку
CREATE TABLE IF NOT EXISTS staff_request_assignments (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES staff_requests(id) ON DELETE CASCADE,
  position_id INTEGER NOT NULL REFERENCES staff_request_positions(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  assigned_role VARCHAR(50) NOT NULL,
  employee_original_role VARCHAR(100),
  role_mismatch BOOLEAN DEFAULT false,
  status VARCHAR(20) DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'rejected', 'replaced', 'added_to_crew')),
  replaced_by INTEGER REFERENCES staff_request_assignments(id),
  assigned_by INTEGER REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(request_id, employee_id)
);
CREATE INDEX IF NOT EXISTS idx_sra_request ON staff_request_assignments(request_id);
CREATE INDEX IF NOT EXISTS idx_sra_employee ON staff_request_assignments(employee_id);

-- Новая колонка статуса v2
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS status_v2 VARCHAR(20) DEFAULT 'draft'
  CHECK (status_v2 IN ('draft','new','in_progress','sent_to_pm','approved','added_to_crew','rework','cancelled'));

-- Обратная совместимость: инициализация status_v2 из старого status
UPDATE staff_requests SET status_v2 = CASE
  WHEN status = 'sent'     THEN 'new'
  WHEN status = 'answered' THEN 'sent_to_pm'
  WHEN status = 'approved' THEN 'approved'
  WHEN status = 'rework'   THEN 'rework'
  ELSE 'new'
END WHERE status_v2 = 'draft' AND status IS NOT NULL;
