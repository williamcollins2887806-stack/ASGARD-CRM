DROP INDEX IF EXISTS idx_call_history_pre_tender;
ALTER TABLE call_history DROP COLUMN IF EXISTS pre_tender_id;
