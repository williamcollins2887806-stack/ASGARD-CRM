-- ═══════════════════════════════════════════════════════════════════════════
-- HR Module v2 — Сессия 1, Шаг 1, Волна 4
-- V144: Обучение и допуски (worker_training)
--
-- work_permit_requirements уже существует (V001), используем как есть.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS worker_training (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  work_id INTEGER REFERENCES works(id),
  staff_request_id INTEGER REFERENCES staff_requests(id),
  permit_type_id INTEGER REFERENCES permit_types(id),
  training_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  deadline DATE,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'cancelled')),
  started_at DATE,
  completed_at DATE,
  trainer_name VARCHAR(255),
  certificate_number VARCHAR(100),
  certificate_file VARCHAR(500),
  certificate_original_name VARCHAR(500),
  valid_from DATE,
  valid_to DATE,
  assigned_by INTEGER REFERENCES users(id),
  completed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_emp ON worker_training(employee_id, status);
CREATE INDEX IF NOT EXISTS idx_training_work ON worker_training(work_id, status);
CREATE INDEX IF NOT EXISTS idx_training_deadline ON worker_training(deadline) WHERE status IN ('pending', 'in_progress');
