-- ═══════════════════════════════════════════════════════════════════════════
-- V029: Fix schema-route mismatches discovered by comprehensive tests
-- Routes expect columns that don't exist in tables.
-- Add missing columns to align DB schema with API contracts.
-- Idempotent (all use IF NOT EXISTS).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. estimates: route accepts title, amount, cost, margin, notes, customer, object_name, work_type, priority, deadline ───
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS amount NUMERIC(15,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS cost NUMERIC(15,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS margin NUMERIC(15,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS customer TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS object_name TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS work_type VARCHAR(100);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS priority VARCHAR(50);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS description TEXT;

-- Fix margin column: was NUMERIC(5,2) = max 999.99, route accepts absolute values
ALTER TABLE estimates ALTER COLUMN margin TYPE NUMERIC(15,2);

-- ─── 2. calendar_events: route expects end_date, end_time, color, participants, location, tender_id, work_id, is_all_day, recurrence ───
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS color VARCHAR(20);
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS participants JSONB DEFAULT '[]';
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS tender_id INTEGER;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS work_id INTEGER;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS is_all_day BOOLEAN DEFAULT false;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS recurrence TEXT;

-- ─── 3. employee_plan: route expects object_name, shift_type, hours, notes, status ───
ALTER TABLE employee_plan ADD COLUMN IF NOT EXISTS object_name VARCHAR(500);
ALTER TABLE employee_plan ADD COLUMN IF NOT EXISTS shift_type VARCHAR(50);
ALTER TABLE employee_plan ADD COLUMN IF NOT EXISTS hours NUMERIC(6,2);
ALTER TABLE employee_plan ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE employee_plan ADD COLUMN IF NOT EXISTS status VARCHAR(50);

-- ─── 4. office_expenses: route expects notes, receipt_url ───
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;

-- ─── 5. work_expenses: route expects notes, receipt_url ───
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS receipt_url TEXT;

SELECT 'V029 applied — schema-route mismatches fixed' AS result;
