-- V288: планируемое привлечение рабочих на проект (параллельный слой, не on_site)
CREATE TABLE IF NOT EXISTS employee_planned_engagements (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  planned_from DATE,
  planned_to DATE,
  note TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'cancelled')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_employee_one_active_plan
  ON employee_planned_engagements(employee_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_planned_engagements_work
  ON employee_planned_engagements(work_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_planned_engagements_status
  ON employee_planned_engagements(status);

COMMENT ON TABLE employee_planned_engagements IS 'Планируемое привлечение на проект — не создаёт employee_assignments';
