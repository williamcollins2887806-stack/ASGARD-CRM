-- ═══════════════════════════════════════════════════════════════════════════
-- V035: Enhanced AI analysis fields for pre-tender requests
-- Adds urgency, risk factors, required specialists, auto-suggestion, confidence
-- ═══════════════════════════════════════════════════════════════════════════

-- Срочность заявки (определяется AI)
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_urgency VARCHAR(20);

-- Факторы риска (массив строк от AI)
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_risk_factors JSONB DEFAULT '[]';

-- Требуемые специалисты (массив типов)
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_required_specialists JSONB DEFAULT '[]';

-- AI-рекомендация действия: accept_green, review, reject_red, need_info
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_auto_suggestion VARCHAR(30);

-- Уверенность AI-анализа (0.00 - 1.00)
ALTER TABLE pre_tender_requests ADD COLUMN IF NOT EXISTS ai_confidence NUMERIC(3,2);

SELECT 'V035 applied successfully' as result;
