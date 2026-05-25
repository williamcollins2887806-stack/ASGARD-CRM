-- V119: timesheet_disputes — разногласия рабочих по табелю
-- ──────────────────────────────────────────────────────────────────────────────
-- Рабочий нажимает «🚩 Я не согласен» в приложении (FieldEarningsMonthly) →
-- создаётся спор. РП видит споры в карточке работы → вкладка «Разногласия» →
-- либо подтверждает (автоматически создаётся field_checkins),
-- либо отклоняет с комментарием.

CREATE TABLE IF NOT EXISTS timesheet_disputes (
  id              SERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  work_id         INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,

  -- К какому периоду относится спор. Опционально и dispute_date, и месяц/год —
  -- рабочий может ткнуть «не согласен с днём» или «не согласен с месяцем».
  dispute_date    DATE,
  dispute_month   INTEGER CHECK (dispute_month BETWEEN 1 AND 12),
  dispute_year    INTEGER CHECK (dispute_year BETWEEN 2020 AND 2100),

  dispute_type    TEXT NOT NULL CHECK (dispute_type IN (
    'missing_shift',         -- не отмечена смена
    'missing_travel',        -- не учтена дорога
    'missing_medical',       -- не учтён медосмотр
    'missing_waiting',       -- не учтено ожидание / простой
    'wrong_hours',           -- неправильные часы
    'wrong_amount',          -- неправильная сумма
    'wrong_per_diem',        -- неправильные суточные
    'other'                  -- другое
  )),
  worker_comment  TEXT NOT NULL,

  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN (
    'open',         -- ждёт реакции РП
    'in_review',    -- РП взял в работу
    'resolved',     -- РП подтвердил (создал/исправил смену)
    'rejected'      -- РП отклонил с комментарием
  )),
  pm_response     TEXT,
  pm_user_id      INTEGER REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,

  -- Если РП подтвердил и создал смену через резолюцию — ссылка на неё.
  -- Не FK на DELETE CASCADE — спор должен остаться даже если смену потом удалят.
  created_checkin_id INTEGER REFERENCES field_checkins(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Индекс для списка споров рабочего (мои споры)
CREATE INDEX IF NOT EXISTS idx_disputes_employee
  ON timesheet_disputes(employee_id, status, created_at DESC);

-- Индекс для РП — открытые споры по конкретной работе
CREATE INDEX IF NOT EXISTS idx_disputes_work_open
  ON timesheet_disputes(work_id, created_at DESC)
  WHERE status IN ('open', 'in_review');

-- Триггер updated_at
CREATE OR REPLACE FUNCTION timesheet_disputes_touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_disputes_touch ON timesheet_disputes;
CREATE TRIGGER trg_disputes_touch
  BEFORE UPDATE ON timesheet_disputes
  FOR EACH ROW
  EXECUTE FUNCTION timesheet_disputes_touch_updated_at();

COMMENT ON TABLE  timesheet_disputes IS 'Разногласия рабочих по табелю — формы обратной связи от рабочего к РП';
COMMENT ON COLUMN timesheet_disputes.dispute_date IS 'Конкретный день, с которым не согласен рабочий (опционально)';
COMMENT ON COLUMN timesheet_disputes.dispute_month IS 'Месяц спора если рабочий не уверен в конкретной дате';
COMMENT ON COLUMN timesheet_disputes.created_checkin_id IS 'Если РП через резолюцию создал/исправил field_checkins — ссылка для аудита';
