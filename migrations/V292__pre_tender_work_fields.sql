-- V292: отдельные поля работы для pre_tender_requests (канбан v3 drawer)
ALTER TABLE pre_tender_requests
  ADD COLUMN IF NOT EXISTS ai_work_type VARCHAR(200),
  ADD COLUMN IF NOT EXISTS work_volume NUMERIC,
  ADD COLUMN IF NOT EXISTS work_volume_unit VARCHAR(30),
  ADD COLUMN IF NOT EXISTS work_start_plan DATE,
  ADD COLUMN IF NOT EXISTS work_end_plan DATE;
