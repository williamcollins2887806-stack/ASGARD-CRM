-- V066: Add missing columns to staff_requests
-- The table was created in V001 with only (id, created_by, status, created_at, updated_at)
-- Frontend code (hr_requests.js, pm_works.js) writes to these columns
-- but data.js silently filters them out because they don't exist in the table.

ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS work_id INTEGER;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS pm_id INTEGER REFERENCES users(id);
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS request_json JSONB;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS proposed_staff_ids_json JSONB;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS approved_staff_ids_json JSONB;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS hr_comment TEXT DEFAULT '';
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS pm_comment TEXT DEFAULT '';
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS rotation_days INTEGER DEFAULT 0;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS is_vachta BOOLEAN DEFAULT false;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS date_from DATE;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS date_to DATE;

-- Add index for work_id lookup
CREATE INDEX IF NOT EXISTS idx_staff_requests_work_id ON staff_requests(work_id);
