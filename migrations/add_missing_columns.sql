-- ASGARD CRM — Добавление всех недостающих колонок
-- Сгенерировано автоматически на основе анализа JS-кода
-- Запуск: sudo -u postgres psql asgard_crm -f scripts/add_missing_columns.sql

-- ═══════════════════════════════════════════════════════════════════════════════
-- TENDERS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS purchase_url TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS group_tag TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_comment_to TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_description TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_region TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_contact TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_phone TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_email TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS handoff_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS handoff_by_user_id INTEGER;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS distribution_requested_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS distribution_requested_by_user_id INTEGER;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS distribution_assigned_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS distribution_assigned_by_user_id INTEGER;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS require_docs_on_handoff BOOLEAN DEFAULT false;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tkp_sent_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tkp_followup_next_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tkp_followup_closed_at TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ESTIMATES (просчёты)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS probability_pct INTEGER DEFAULT 50;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS payment_terms TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS calc_v2_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS calc_summary_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS quick_calc_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS profit_per_day NUMERIC(15,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS price_with_vat NUMERIC(15,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS margin_pct NUMERIC(5,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS overhead_pct NUMERIC(5,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS vat_pct NUMERIC(5,2) DEFAULT 20;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS fot_tax_pct NUMERIC(5,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS profit_tax_pct NUMERIC(5,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS consumables_pct NUMERIC(5,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS approval_status TEXT DEFAULT 'draft';
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS approval_comment TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS decided_by_user_id INTEGER;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS sent_for_approval_at TIMESTAMP;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS version_no INTEGER DEFAULT 1;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS items_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS staff_ids_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS proposed_staff_ids_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS approved_staff_ids_json JSONB;

-- ═══════════════════════════════════════════════════════════════════════════════
-- NOTIFICATIONS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS day_key TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedup_key TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link_hash TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id INTEGER;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUDIT_LOG
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS payload_json JSONB;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT now();
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT now();

-- ═══════════════════════════════════════════════════════════════════════════════
-- USERS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS military_id TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- WORKS (работы)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE works ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
ALTER TABLE works ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE works ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP;
ALTER TABLE works ADD COLUMN IF NOT EXISTS closeout_submitted_at TIMESTAMP;
ALTER TABLE works ADD COLUMN IF NOT EXISTS staff_ids_json JSONB;
ALTER TABLE works ADD COLUMN IF NOT EXISTS proposed_staff_ids_a_json JSONB;
ALTER TABLE works ADD COLUMN IF NOT EXISTS proposed_staff_ids_b_json JSONB;
ALTER TABLE works ADD COLUMN IF NOT EXISTS approved_staff_ids_a_json JSONB;
ALTER TABLE works ADD COLUMN IF NOT EXISTS approved_staff_ids_b_json JSONB;
ALTER TABLE works ADD COLUMN IF NOT EXISTS rework_requested_at TIMESTAMP;
ALTER TABLE works ADD COLUMN IF NOT EXISTS advance_pct NUMERIC(5,2);
ALTER TABLE works ADD COLUMN IF NOT EXISTS w_adv_pct NUMERIC(5,2);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CUSTOMERS (контрагенты)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contacts_json JSONB;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_review_at TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CHAT_MESSAGES
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS entity_type TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- BONUS_REQUESTS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE bonus_requests ADD COLUMN IF NOT EXISTS bonuses_json JSONB;
ALTER TABLE bonus_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP;
ALTER TABLE bonus_requests ADD COLUMN IF NOT EXISTS decided_by_user_id INTEGER;
ALTER TABLE bonus_requests ADD COLUMN IF NOT EXISTS director_comment TEXT;

-- ═══════════════════════════════════════════════════════════════════════════════
-- HR_REQUESTS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS request_json JSONB;
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP;
ALTER TABLE hr_requests ADD COLUMN IF NOT EXISTS decided_by_user_id INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- PURCHASE_REQUESTS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS items_json JSONB;
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP;
ALTER TABLE purchase_requests ADD COLUMN IF NOT EXISTS decided_by_user_id INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- DOCUMENTS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE documents ADD COLUMN IF NOT EXISTS file_url TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS download_url TEXT;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS uploaded_by_user_id INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- INVOICES
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS items_json JSONB;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS exported_at TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════════════════
-- EXPENSES
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CALENDAR_EVENTS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS dates_json JSONB;
ALTER TABLE calendar_events ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════════════════
-- REMINDERS
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS next_at TIMESTAMP;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS sent_at TIMESTAMP;

-- Готово!
SELECT 'Все колонки добавлены успешно!' as result;
