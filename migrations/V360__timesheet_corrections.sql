-- V360: timesheet_corrections — запрос РП на исправление дня (офис/мастер)
-- D-258. Обратное направление к timesheet_disputes (рабочий → РП).

CREATE TABLE IF NOT EXISTS timesheet_corrections (
  id                   SERIAL PRIMARY KEY,
  work_id              INTEGER REFERENCES works(id) ON DELETE SET NULL,
  employee_id          INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  correction_date      DATE NOT NULL,
  expected_type        TEXT,
  expected_points      NUMERIC(8,2),
  message              TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open', 'resolved', 'cancelled')),
  created_by_user_id   INTEGER NOT NULL REFERENCES users(id),
  target_user_id       INTEGER REFERENCES users(id),
  resolved_at          TIMESTAMPTZ,
  resolved_by_user_id  INTEGER REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ts_corr_open_date
  ON timesheet_corrections(correction_date DESC)
  WHERE status = 'open';

CREATE INDEX IF NOT EXISTS idx_ts_corr_work
  ON timesheet_corrections(work_id, status)
  WHERE work_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ts_corr_target
  ON timesheet_corrections(target_user_id, status)
  WHERE target_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ts_corr_employee_date
  ON timesheet_corrections(employee_id, correction_date);

COMMENT ON TABLE timesheet_corrections IS
  'D-258: РП ставит «корректировку» — офис/мастер видит и исправляет отметку';
