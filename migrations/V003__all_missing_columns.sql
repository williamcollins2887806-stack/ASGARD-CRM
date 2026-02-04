-- ASGARD CRM — Полная синхронизация схемы БД
-- Сгенерировано на основе полного анализа src/ и public/assets/js/
-- Запуск: sudo -u postgres psql asgard_crm -f migrations/V003__all_missing_columns.sql
-- ═══════════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════════
-- USERS (Пользователи)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS temp_password_expires TIMESTAMP;
ALTER TABLE users ADD COLUMN IF NOT EXISTS roles TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ready BOOLEAN DEFAULT true;

-- ═══════════════════════════════════════════════════════════════════════════════
-- CUSTOMERS (Контрагенты)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE customers ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS kpp VARCHAR(20);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS ogrn VARCHAR(20);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS email VARCHAR(255);
ALTER TABLE customers ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS contacts_json JSONB;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_review_at TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════════════════
-- TENDERS (Тендеры)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS year INTEGER;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_number VARCHAR(100);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS purchase_url TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS group_tag TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tag TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_comment_to TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS comment_to TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS comment_dir TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_description TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_region TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_contact TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_phone TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_email TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS docs_link TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS reject_reason TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS estimated_sum NUMERIC(15,2);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS pm_login VARCHAR(100);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS saved_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS handoff_by_user_id INTEGER;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS distribution_requested_by_user_id INTEGER;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS distribution_assigned_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS distribution_assigned_by_user_id INTEGER;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS require_docs_on_handoff BOOLEAN DEFAULT false;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tkp_sent_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tkp_followup_next_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tkp_followup_closed_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS created_by INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ESTIMATES (Просчёты / ТКП)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS work_id INTEGER;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS status VARCHAR(50);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS estimate_data_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS calc_v2_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS quick_calc_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS profit_per_day NUMERIC(15,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS price_with_vat NUMERIC(15,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS margin_pct NUMERIC(5,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS overhead_pct NUMERIC(5,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS vat_pct NUMERIC(5,2) DEFAULT 20;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS fot_tax_pct NUMERIC(5,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS profit_tax_pct NUMERIC(5,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS consumables_pct NUMERIC(5,2);
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS decided_by_user_id INTEGER;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS items_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS staff_ids_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS proposed_staff_ids_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS approved_staff_ids_json JSONB;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS created_by INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- WORKS (Работы / Контракты)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE works ADD COLUMN IF NOT EXISTS work_number VARCHAR(100);
ALTER TABLE works ADD COLUMN IF NOT EXISTS work_name TEXT;
ALTER TABLE works ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255);
ALTER TABLE works ADD COLUMN IF NOT EXISTS start_plan DATE;
ALTER TABLE works ADD COLUMN IF NOT EXISTS work_end_plan DATE;
ALTER TABLE works ADD COLUMN IF NOT EXISTS advance_received NUMERIC(15,2);
ALTER TABLE works ADD COLUMN IF NOT EXISTS advance_date_fact DATE;
ALTER TABLE works ADD COLUMN IF NOT EXISTS balance_received NUMERIC(15,2);
ALTER TABLE works ADD COLUMN IF NOT EXISTS payment_date_fact DATE;
ALTER TABLE works ADD COLUMN IF NOT EXISTS act_signed_date_fact DATE;
ALTER TABLE works ADD COLUMN IF NOT EXISTS closeout_submitted_at TIMESTAMP;
ALTER TABLE works ADD COLUMN IF NOT EXISTS closeout_submitted_by INTEGER;
ALTER TABLE works ADD COLUMN IF NOT EXISTS staff_ids_json JSONB;
ALTER TABLE works ADD COLUMN IF NOT EXISTS proposed_staff_ids_a_json JSONB;
ALTER TABLE works ADD COLUMN IF NOT EXISTS proposed_staff_ids_b_json JSONB;
ALTER TABLE works ADD COLUMN IF NOT EXISTS approved_staff_ids_a_json JSONB;
ALTER TABLE works ADD COLUMN IF NOT EXISTS approved_staff_ids_b_json JSONB;
ALTER TABLE works ADD COLUMN IF NOT EXISTS rework_requested_at TIMESTAMP;
ALTER TABLE works ADD COLUMN IF NOT EXISTS w_adv_pct NUMERIC(5,2);
ALTER TABLE works ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
ALTER TABLE works ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE works ADD COLUMN IF NOT EXISTS created_by INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- WORK_EXPENSES (Расходы по работам)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS fot_employee_id INTEGER;
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS fot_employee_name VARCHAR(255);
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS requires_approval BOOLEAN DEFAULT false;
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS approval_status VARCHAR(50);
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS status VARCHAR(50);
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS created_by INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- ACTS (Акты выполненных работ)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS acts (
  id SERIAL PRIMARY KEY,
  act_number VARCHAR(100),
  act_date DATE,
  status VARCHAR(50) DEFAULT 'draft',
  work_id INTEGER,
  customer_name VARCHAR(255),
  customer_inn VARCHAR(20),
  description TEXT,
  amount NUMERIC(15,2),
  vat_pct NUMERIC(5,2) DEFAULT 20,
  total_amount NUMERIC(15,2),
  signed_date DATE,
  paid_date DATE,
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INVOICES (Счета)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(100),
  invoice_date DATE,
  invoice_type VARCHAR(50),
  status VARCHAR(50) DEFAULT 'pending',
  work_id INTEGER,
  act_id INTEGER,
  customer_name VARCHAR(255),
  customer_inn VARCHAR(20),
  customer_id VARCHAR(20),
  description TEXT,
  amount NUMERIC(15,2),
  vat_pct NUMERIC(5,2) DEFAULT 20,
  total_amount NUMERIC(15,2),
  due_date DATE,
  paid_amount NUMERIC(15,2) DEFAULT 0,
  items_json JSONB,
  exported_at TIMESTAMP,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INVOICE_PAYMENTS (Платежи по счетам)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER,
  amount NUMERIC(15,2),
  payment_date DATE,
  comment TEXT,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- INCOMES (Поступления)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS incomes (
  id SERIAL PRIMARY KEY,
  work_id INTEGER,
  type VARCHAR(50),
  date DATE,
  amount NUMERIC(15,2),
  article VARCHAR(100),
  description TEXT,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- OFFICE_EXPENSES (Офисные расходы)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS office_expenses (
  id SERIAL PRIMARY KEY,
  category VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending',
  date DATE,
  amount NUMERIC(15,2),
  description TEXT,
  requires_approval BOOLEAN DEFAULT false,
  approval_status VARCHAR(50),
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- TRAVEL_EXPENSES (Командировочные)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS travel_expenses (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER,
  trip_start DATE,
  trip_end DATE,
  location TEXT,
  purpose TEXT,
  daily_allowance NUMERIC(15,2),
  accommodation NUMERIC(15,2),
  transport NUMERIC(15,2),
  meals NUMERIC(15,2),
  other NUMERIC(15,2),
  total NUMERIC(15,2),
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EMPLOYEES (Сотрудники)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE employees ADD COLUMN IF NOT EXISTS full_name VARCHAR(255);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS gender VARCHAR(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS grade VARCHAR(50);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pass_series VARCHAR(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS pass_number VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS snils VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS imt_number VARCHAR(50);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS imt_expires DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS permits JSONB;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS rating_avg NUMERIC(3,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS rating_count INTEGER DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS docs_url TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS position VARCHAR(100);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EMPLOYEE_ASSIGNMENTS (Назначения на работы)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS employee_assignments (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER,
  work_id INTEGER,
  date_from DATE,
  date_to DATE,
  role_on_work VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EMPLOYEE_REVIEWS (Оценки сотрудников)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS employee_reviews (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER,
  work_id INTEGER,
  pm_id INTEGER,
  rating INTEGER,
  score INTEGER,
  score_1_10 INTEGER,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EMPLOYEE_PLAN (График назначений)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS employee_plan (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER,
  date DATE,
  kind VARCHAR(50),
  work_id INTEGER,
  staff_request_id INTEGER,
  created_by INTEGER,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- STAFF_REQUESTS (Запросы персонала)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staff_requests (
  id SERIAL PRIMARY KEY,
  work_id INTEGER,
  pm_id INTEGER,
  status VARCHAR(50) DEFAULT 'new',
  requested_count INTEGER,
  is_vachta BOOLEAN DEFAULT false,
  crew TEXT,
  requested_at TIMESTAMP,
  answered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- STAFF_REQUEST_MESSAGES (Переписка по персоналу)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staff_request_messages (
  id SERIAL PRIMARY KEY,
  staff_request_id INTEGER,
  author_user_id INTEGER,
  text TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- STAFF_REPLACEMENTS (Замены сотрудников)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staff_replacements (
  id SERIAL PRIMARY KEY,
  staff_request_id INTEGER,
  work_id INTEGER,
  old_employee_id INTEGER,
  new_employee_id INTEGER,
  status VARCHAR(50) DEFAULT 'sent',
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- STAFF (Офисный персонал)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE staff ADD COLUMN IF NOT EXISTS user_id INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- STAFF_PLAN (График офиса)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS staff_plan (
  id SERIAL PRIMARY KEY,
  staff_id INTEGER,
  date DATE,
  status_code VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BONUS_REQUESTS (Согласования премий)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE bonus_requests ADD COLUMN IF NOT EXISTS decided_at TIMESTAMP;
ALTER TABLE bonus_requests ADD COLUMN IF NOT EXISTS decided_by_user_id INTEGER;

-- ═══════════════════════════════════════════════════════════════════════════════
-- HR_REQUESTS (HR заявки)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS hr_requests (
  id SERIAL PRIMARY KEY,
  requester_id INTEGER,
  request_type VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending',
  request_json JSONB,
  decided_at TIMESTAMP,
  decided_by_user_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PURCHASE_REQUESTS (Запросы закупок)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS purchase_requests (
  id SERIAL PRIMARY KEY,
  work_id INTEGER,
  pm_id INTEGER,
  status VARCHAR(50) DEFAULT 'pending',
  items_json JSONB,
  requested_at TIMESTAMP,
  answered_at TIMESTAMP,
  decided_at TIMESTAMP,
  decided_by_user_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- QA_MESSAGES (Вопросы к просчётам)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS qa_messages (
  id SERIAL PRIMARY KEY,
  estimate_id INTEGER,
  author_user_id INTEGER,
  text TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- PM_CONSENTS (Согласования РП)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pm_consents (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  pm_id INTEGER,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CUSTOMER_REVIEWS (Оценки заказчиков)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS customer_reviews (
  id SERIAL PRIMARY KEY,
  work_id INTEGER,
  pm_id INTEGER,
  score INTEGER,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- NOTIFICATIONS (Уведомления)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS kind TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS day_key VARCHAR(20);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dedup_key TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link_hash TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_id INTEGER;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════════════════
-- DOCUMENTS (Документы)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  doc_set_id INTEGER,
  tender_id INTEGER,
  work_id INTEGER,
  type VARCHAR(100),
  filename TEXT,
  original_name TEXT,
  mime_type VARCHAR(100),
  size INTEGER,
  name TEXT,
  data_url TEXT,
  file_url TEXT,
  download_url TEXT,
  user_id INTEGER,
  uploaded_by INTEGER,
  uploaded_by_user_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- DOC_SETS (Комплекты документов)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS doc_sets (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER,
  work_id INTEGER,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CONTRACTS (Договоры)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  customer_inn VARCHAR(20),
  contract_number VARCHAR(100),
  contract_date DATE,
  contract_value NUMERIC(15,2),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CALENDAR_EVENTS (Календарь)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS calendar_events (
  id SERIAL PRIMARY KEY,
  date DATE,
  time TIME,
  type VARCHAR(50),
  title TEXT,
  description TEXT,
  reminder_minutes INTEGER,
  reminder_sent BOOLEAN DEFAULT false,
  dates_json JSONB,
  confirmed_at TIMESTAMP,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- REMINDERS (Напоминания)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  reminder_type VARCHAR(50),
  entity_id INTEGER,
  entity_type VARCHAR(50),
  title TEXT,
  message TEXT,
  is_read BOOLEAN DEFAULT false,
  next_at TIMESTAMP,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CORRESPONDENCE (Переписка)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS correspondence (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER,
  work_id INTEGER,
  direction VARCHAR(20),
  subject TEXT,
  body TEXT,
  attachments JSONB,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- USER_CALL_STATUS (Статус звонков)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_call_status (
  user_id INTEGER PRIMARY KEY,
  call_status VARCHAR(50),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- CALL_HISTORY (История звонков)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS call_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  phone VARCHAR(50),
  duration INTEGER,
  status VARCHAR(50),
  direction VARCHAR(20),
  call_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EMAIL_LOG / EMAIL_HISTORY (Журнал email)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS email_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  to_email VARCHAR(255),
  subject TEXT,
  status VARCHAR(50),
  message_id TEXT,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EMAIL_QUEUE (Очередь email)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS email_queue (
  id SERIAL PRIMARY KEY,
  to_email VARCHAR(255),
  subject TEXT,
  body TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  last_error TEXT,
  scheduled_at TIMESTAMP,
  sent_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- AUDIT_LOG (Аудит)
-- ═══════════════════════════════════════════════════════════════════════════════
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS actor_user_id INTEGER;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_type VARCHAR(100);
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS entity_id INTEGER;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE audit_log ADD COLUMN IF NOT EXISTS payload_json JSONB;

-- ═══════════════════════════════════════════════════════════════════════════════
-- SAVED_REPORTS (Сохранённые отчёты)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS saved_reports (
  id SERIAL PRIMARY KEY,
  type VARCHAR(100),
  period VARCHAR(50),
  period_code VARCHAR(20),
  data JSONB,
  user_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- BANK_RULES (Правила импорта банка)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS bank_rules (
  id SERIAL PRIMARY KEY,
  rule_name VARCHAR(255),
  pattern TEXT,
  work_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SYNC_META (Метаданные синхронизации)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sync_meta (
  key VARCHAR(100) PRIMARY KEY,
  value TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EQUIPMENT (Оборудование)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS equipment (
  id SERIAL PRIMARY KEY,
  inventory_number VARCHAR(100),
  name VARCHAR(255),
  category_id INTEGER,
  serial_number VARCHAR(100),
  barcode VARCHAR(100),
  qr_code TEXT,
  qr_uuid UUID,
  purchase_price NUMERIC(15,2),
  purchase_date DATE,
  invoice_id INTEGER,
  quantity INTEGER DEFAULT 1,
  unit VARCHAR(20),
  warranty_end DATE,
  maintenance_interval_days INTEGER,
  useful_life_months INTEGER,
  salvage_value NUMERIC(15,2),
  auto_write_off BOOLEAN DEFAULT false,
  book_value NUMERIC(15,2),
  brand VARCHAR(100),
  model VARCHAR(100),
  specifications JSONB,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'available',
  warehouse_id INTEGER,
  balance_status VARCHAR(50),
  balance_date DATE,
  condition VARCHAR(50),
  next_maintenance DATE,
  next_calibration DATE,
  current_holder_id INTEGER,
  current_object_id INTEGER,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  written_off_date DATE,
  written_off_reason TEXT,
  written_off_by INTEGER,
  accumulated_depreciation NUMERIC(15,2)
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EQUIPMENT_CATEGORIES (Категории оборудования)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS equipment_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  code VARCHAR(50),
  icon VARCHAR(50),
  is_consumable BOOLEAN DEFAULT false,
  sort_order INTEGER,
  requires_calibration BOOLEAN DEFAULT false
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- WAREHOUSES (Склады)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS warehouses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  is_main BOOLEAN DEFAULT false,
  responsible_id INTEGER,
  is_active BOOLEAN DEFAULT true
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- OBJECTS (Объекты)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS objects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  is_active BOOLEAN DEFAULT true
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EQUIPMENT_MOVEMENTS (Перемещения оборудования)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS equipment_movements (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER,
  movement_type VARCHAR(50),
  from_warehouse_id INTEGER,
  to_warehouse_id INTEGER,
  from_holder_id INTEGER,
  to_holder_id INTEGER,
  from_object_id INTEGER,
  to_object_id INTEGER,
  work_id INTEGER,
  quantity INTEGER,
  condition_before VARCHAR(50),
  condition_after VARCHAR(50),
  notes TEXT,
  confirmed BOOLEAN DEFAULT false,
  confirmed_at TIMESTAMP,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EQUIPMENT_REQUESTS (Заявки на оборудование)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS equipment_requests (
  id SERIAL PRIMARY KEY,
  request_type VARCHAR(50),
  requester_id INTEGER,
  equipment_id INTEGER,
  work_id INTEGER,
  object_id INTEGER,
  target_holder_id INTEGER,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  reject_reason TEXT,
  processed_by INTEGER,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EQUIPMENT_MAINTENANCE (Обслуживание оборудования)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS equipment_maintenance (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER,
  maintenance_type VARCHAR(50),
  description TEXT,
  cost NUMERIC(15,2),
  spare_parts TEXT,
  performed_by INTEGER,
  contractor VARCHAR(255),
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  next_date DATE,
  invoice_id INTEGER,
  notes TEXT,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EQUIPMENT_RESERVATIONS (Бронирование оборудования)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS equipment_reservations (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER,
  work_id INTEGER,
  reserved_by INTEGER,
  reserved_from DATE,
  reserved_to DATE,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- USER_DASHBOARD (Настройки дашборда)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_dashboard (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE,
  layout_json JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEALS (Печати)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS seals (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  current_holder_id INTEGER,
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- SEAL_TRANSFERS (Передачи печатей)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS seal_transfers (
  id SERIAL PRIMARY KEY,
  seal_id INTEGER,
  from_user_id INTEGER,
  to_user_id INTEGER,
  transfer_date TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- EMPLOYEE_PERMITS (Допуски сотрудников)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS employee_permits (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER,
  permit_type VARCHAR(100),
  permit_number VARCHAR(100),
  issue_date DATE,
  expiry_date DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- USER_REQUESTS (Заявки пользователей)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS user_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  request_type VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending',
  data_json JSONB,
  processed_by INTEGER,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- WORK_ASSIGN_REQUESTS (Заявки на назначение работ)
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS work_assign_requests (
  id SERIAL PRIMARY KEY,
  work_id INTEGER,
  requester_id INTEGER,
  target_pm_id INTEGER,
  status VARCHAR(50) DEFAULT 'pending',
  notes TEXT,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- Индексы для производительности
-- ═══════════════════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_tenders_period ON tenders(period);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(tender_status);
CREATE INDEX IF NOT EXISTS idx_tenders_pm ON tenders(responsible_pm_id);
CREATE INDEX IF NOT EXISTS idx_works_pm ON works(pm_id);
CREATE INDEX IF NOT EXISTS idx_works_status ON works(work_status);
CREATE INDEX IF NOT EXISTS idx_works_tender ON works(tender_id);
CREATE INDEX IF NOT EXISTS idx_employees_role ON employees(role_tag);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_warehouse ON equipment(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_equipment_holder ON equipment(current_holder_id);

-- Готово!
SELECT 'Все таблицы и колонки добавлены успешно!' as result;
