-- V416 down
ALTER TABLE pre_tender_requests
  DROP COLUMN IF EXISTS work_title,
  DROP COLUMN IF EXISTS ai_scope_items;
