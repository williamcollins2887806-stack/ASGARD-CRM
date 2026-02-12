-- V030: Draft tender status + AI report + Correspondence link
-- Related to: PROMPT_DRAFT_TENDER_AI_v1

-- 1. Add ai_report column to inbox_applications
ALTER TABLE inbox_applications ADD COLUMN IF NOT EXISTS ai_report TEXT;

-- 2. Add linked_inbox_application_id to correspondence
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS linked_inbox_application_id INTEGER REFERENCES inbox_applications(id);

-- 3. Partial index for fast draft lookup
CREATE INDEX IF NOT EXISTS idx_tenders_draft ON tenders(tender_status) WHERE tender_status = 'Черновик';

-- 4. Index for correspondence -> inbox link
CREATE INDEX IF NOT EXISTS idx_correspondence_inbox_app ON correspondence(linked_inbox_application_id) WHERE linked_inbox_application_id IS NOT NULL;
