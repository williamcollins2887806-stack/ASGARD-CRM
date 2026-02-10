-- ═══════════════════════════════════════════════════════════════════════════
-- V027: Missing columns discovered during deep API testing
-- Adds columns referenced in route code but never created in migrations
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- CUSTOMERS — needs serial id (PK is inn) + contact_person
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE customers ADD COLUMN IF NOT EXISTS id SERIAL UNIQUE;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contact_person TEXT;

-- ─────────────────────────────────────────────────────────────────────────
-- TENDERS — 'customer' column used in estimates JOIN (t.customer)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS customer TEXT;

-- ─────────────────────────────────────────────────────────────────────────
-- WORKS — columns referenced in ALLOWED_COLS but missing from V001+V003
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE works ADD COLUMN IF NOT EXISTS start_fact DATE;
ALTER TABLE works ADD COLUMN IF NOT EXISTS object_name VARCHAR(500);
ALTER TABLE works ADD COLUMN IF NOT EXISTS object_address TEXT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS priority VARCHAR(30);
ALTER TABLE works ADD COLUMN IF NOT EXISTS contract_sum NUMERIC(15,2) DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────
-- USERS — is_approved flag for user approval workflow
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT true;

-- ─────────────────────────────────────────────────────────────────────────
-- SITES — status column (general object status, not geocode_status)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE sites ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'active';

SELECT 'V027 applied successfully' as result;
