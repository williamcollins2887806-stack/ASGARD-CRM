-- V055: Аналитика звонков — таблицы отчётов и расписания
-- =====================================================

-- 1. Добавляем ai_quality_score в call_history
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS ai_quality_score SMALLINT;

-- 2. Таблица отчётов по звонкам
CREATE TABLE IF NOT EXISTS call_reports (
  id            SERIAL PRIMARY KEY,
  report_type   VARCHAR(20) NOT NULL DEFAULT 'daily',  -- daily, weekly, monthly
  period_from   DATE NOT NULL,
  period_to     DATE NOT NULL,
  title         VARCHAR(500),
  summary_text  TEXT,
  stats_json    JSONB DEFAULT '{}',
  recommendations_json JSONB DEFAULT '[]',
  generated_by  VARCHAR(20) DEFAULT 'system',  -- system | manual
  requested_by  INTEGER REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_call_reports_type ON call_reports(report_type);
CREATE INDEX IF NOT EXISTS idx_call_reports_period ON call_reports(period_from, period_to);

-- 3. Расписание генерации отчётов
CREATE TABLE IF NOT EXISTS call_report_schedule (
  id              SERIAL PRIMARY KEY,
  report_type     VARCHAR(20) NOT NULL UNIQUE,
  cron_expression VARCHAR(50) NOT NULL,
  is_active       BOOLEAN DEFAULT true,
  notify_roles    TEXT[] DEFAULT ARRAY['ADMIN','DIRECTOR_GEN','DIRECTOR_COMM'],
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Дефолтные расписания
INSERT INTO call_report_schedule (report_type, cron_expression, is_active) VALUES
  ('daily',   '0 8 * * 1-5', true),
  ('weekly',  '0 9 * * 1',   true),
  ('monthly', '0 9 1 * *',   true)
ON CONFLICT (report_type) DO NOTHING;
