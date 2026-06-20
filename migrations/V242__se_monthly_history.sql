-- ═══════════════════════════════════════════════════════════════
-- V242: se_monthly_history — накопление годового лимита НПД
-- Каждый импорт Excel от Озон-Банка пишет в эту таблицу запись за
-- конкретный месяц. yearly_used = SUM(monthly_used) FROM этой таблицы
-- за весь год по конкретному СЗ.
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS se_monthly_history (
  id SERIAL PRIMARY KEY,
  employee_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  year INT NOT NULL CHECK (year BETWEEN 2020 AND 2100),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  monthly_used NUMERIC(12,2) NOT NULL DEFAULT 0,
  source VARCHAR(20) NOT NULL DEFAULT 'import',
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  imported_by INT REFERENCES users(id),
  CONSTRAINT uniq_se_history_emp_period UNIQUE (employee_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_se_history_emp_year ON se_monthly_history(employee_id, year);
CREATE INDEX IF NOT EXISTS idx_se_history_period ON se_monthly_history(year, month);

COMMENT ON TABLE se_monthly_history IS 'История месячного использования НПД-лимита СЗ. Заполняется через POST /api/staff/se-limits/apply (импорт Excel от Озон-Банка) и ручные операции.';
COMMENT ON COLUMN se_monthly_history.monthly_used IS 'Сколько потрачено в этом месяце (для расчёта yearly_used = SUM)';
COMMENT ON COLUMN se_monthly_history.source IS 'import / manual / transfer';
