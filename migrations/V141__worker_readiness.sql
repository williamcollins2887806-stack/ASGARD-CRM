-- ═══════════════════════════════════════════════════════════════════════════
-- HR Module v2 — Сессия 1, Шаг 1, Волна 1
-- V141: Система готовности рабочих (readiness)
--
-- Расширяет employees новыми колонками статуса готовности и журналом
-- изменений (worker_readiness_log) для аудита.
-- ═══════════════════════════════════════════════════════════════════════════

-- Новые колонки в employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS readiness_status VARCHAR(20) DEFAULT 'unknown'
  CHECK (readiness_status IN ('unknown', 'on_site', 'approved', 'ready', 'not_ready', 'archive'));
ALTER TABLE employees ADD COLUMN IF NOT EXISTS readiness_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS readiness_reason VARCHAR(50);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS readiness_comment TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS readiness_updated_at TIMESTAMPTZ;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS readiness_updated_by INTEGER REFERENCES users(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_pm_id INTEGER REFERENCES users(id);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS last_work_id INTEGER REFERENCES works(id);

CREATE INDEX IF NOT EXISTS idx_employees_readiness ON employees(readiness_status, readiness_date);
CREATE INDEX IF NOT EXISTS idx_employees_active_readiness ON employees(is_active, readiness_status);

-- Лог изменений готовности (аудит)
CREATE TABLE IF NOT EXISTS worker_readiness_log (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  old_status VARCHAR(20),
  new_status VARCHAR(20),
  readiness_date DATE,
  reason VARCHAR(50),
  comment TEXT,
  source VARCHAR(20) NOT NULL CHECK (source IN ('hr', 'worker_app', 'auto', 'system')),
  changed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_readiness_log_emp ON worker_readiness_log(employee_id, created_at DESC);
