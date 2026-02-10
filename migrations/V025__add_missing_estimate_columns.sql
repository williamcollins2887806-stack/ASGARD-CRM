-- V025: Add missing columns to estimates table
-- These columns are referenced in the route ALLOWED_COLS but were never created in any migration.
-- Also fixes rating_avg precision and adds tenders.comment_to safety net.

-- ═══════════════════════════════════════════════════════════════════════════════
-- ESTIMATES — columns expected by src/routes/estimates.js ALLOWED_COLS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS title VARCHAR(500);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS amount NUMERIC(15,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS cost NUMERIC(15,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS margin NUMERIC(5,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS customer VARCHAR(500);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS object_name VARCHAR(500);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS work_type VARCHAR(100);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS priority VARCHAR(30);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS deadline DATE;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TENDERS — ensure comment_to and comment_dir exist
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS comment_to TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS comment_dir TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS reject_reason TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- EMPLOYEES — widen rating_avg precision (was NUMERIC(3,2), max 9.99)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE employees ALTER COLUMN rating_avg TYPE NUMERIC(4,2);

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUDIT_LOG — ensure V003-added columns exist
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_user_id INTEGER;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_type VARCHAR(100);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_id INTEGER;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS details TEXT;

SELECT 'V025 applied successfully' as result;
