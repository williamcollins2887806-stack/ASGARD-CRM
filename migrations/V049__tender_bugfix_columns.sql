-- V049: Добавление недостающих колонок для модуля тендеров
-- Код ссылается на эти колонки, но они отсутствуют в миграциях V001-V048

-- === tenders ===
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_description TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS ai_report TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS ai_cost_estimate NUMERIC;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS ai_cost_report TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS work_start_plan DATE;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS work_end_plan DATE;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS created_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS assigned_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS handoff_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS distribution_requested_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS distribution_assigned_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS distribution_assigned_by_user_id INTEGER REFERENCES users(id);

-- === pre_tender_requests ===
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS approval_requested_by INTEGER REFERENCES users(id);
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS approval_requested_at TIMESTAMP;
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS approval_comment TEXT;
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_workload_warning TEXT;
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC;
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_urgency VARCHAR(20);
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_auto_suggestion VARCHAR(50);
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_risk_factors JSONB;
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_required_specialists JSONB;
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_processed_at TIMESTAMP;

-- Индексы
CREATE INDEX IF NOT EXISTS idx_tenders_distribution ON tenders(distribution_requested_at) WHERE distribution_requested_at IS NOT NULL AND handoff_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_pre_tenders_approval ON pre_tender_requests(status) WHERE status = 'pending_approval';
