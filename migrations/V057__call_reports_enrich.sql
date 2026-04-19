-- Дополнительные поля для WOW-отчётов
ALTER TABLE call_reports
  ADD COLUMN IF NOT EXISTS report_html      TEXT,
  ADD COLUMN IF NOT EXISTS metrics          JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS insights         JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS attention_items  JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS viewed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS viewed_by        INTEGER REFERENCES users(id);

-- Индекс для непросмотренных
CREATE INDEX IF NOT EXISTS idx_call_reports_unviewed
  ON call_reports(created_at DESC) WHERE viewed_at IS NULL;

-- Исправить cron: Пн-Пт → Пн-Сб
UPDATE call_report_schedule SET cron_expression = '0 8 * * 1-6'
  WHERE report_type = 'daily' AND cron_expression = '0 8 * * 1-5';
