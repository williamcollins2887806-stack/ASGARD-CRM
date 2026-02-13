-- ASGARD CRM Initial Schema
-- ═══════════════════════════════════════════════════════════════════════════

-- Users
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  login VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255),
  name VARCHAR(255),
  email VARCHAR(255),
  phone VARCHAR(50),
  role VARCHAR(50) DEFAULT 'PM',
  birth_date DATE,
  employment_date DATE,
  telegram_chat_id VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  must_change_password BOOLEAN DEFAULT false,
  temp_password_hash VARCHAR(255),
  temp_password_expires TIMESTAMP,
  pin_hash VARCHAR(255),
  roles TEXT[],
  last_login_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Settings
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(255) PRIMARY KEY,
  value_json TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Customers
CREATE TABLE IF NOT EXISTS customers (
  inn VARCHAR(50) PRIMARY KEY,
  name VARCHAR(500),
  address TEXT,
  phone VARCHAR(100),
  email VARCHAR(255),
  contact_person VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tenders
CREATE TABLE IF NOT EXISTS tenders (
  id SERIAL PRIMARY KEY,
  period VARCHAR(20),
  year INTEGER,
  customer_name VARCHAR(500),
  customer_inn VARCHAR(50),
  tender_title TEXT,
  tender_type VARCHAR(100),
  tender_status VARCHAR(100) DEFAULT 'Новый',
  tender_price NUMERIC(15,2),
  purchase_url TEXT,
  docs_deadline DATE,
  work_start_plan DATE,
  work_end_plan DATE,
  responsible_pm_id INTEGER REFERENCES users(id),
  created_by_user_id INTEGER REFERENCES users(id),
  distribution_requested_at TIMESTAMP,
  handoff_at TIMESTAMP,
  group_tag VARCHAR(255),
  comment_to TEXT,
  comment_dir TEXT,
  reject_reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Estimates
CREATE TABLE IF NOT EXISTS estimates (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER REFERENCES tenders(id),
  name VARCHAR(500),
  pm_id INTEGER REFERENCES users(id),
  approval_status VARCHAR(50) DEFAULT 'draft',
  items JSONB DEFAULT '[]',
  subtotal NUMERIC(15,2),
  vat NUMERIC(15,2),
  total NUMERIC(15,2),
  comment TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Works
CREATE TABLE IF NOT EXISTS works (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER REFERENCES tenders(id),
  work_number VARCHAR(100),
  work_title VARCHAR(500),
  customer_name VARCHAR(500),
  contract_sum NUMERIC(15,2),
  work_status VARCHAR(100) DEFAULT 'Новая',
  pm_id INTEGER REFERENCES users(id),
  start_date DATE,
  end_date DATE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Work Expenses
CREATE TABLE IF NOT EXISTS work_expenses (
  id SERIAL PRIMARY KEY,
  work_id INTEGER REFERENCES works(id),
  category VARCHAR(100),
  description TEXT,
  amount NUMERIC(15,2),
  date DATE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Office Expenses
CREATE TABLE IF NOT EXISTS office_expenses (
  id SERIAL PRIMARY KEY,
  category VARCHAR(100),
  description TEXT,
  amount NUMERIC(15,2),
  status VARCHAR(50) DEFAULT 'pending',
  date DATE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Incomes
CREATE TABLE IF NOT EXISTS incomes (
  id SERIAL PRIMARY KEY,
  work_id INTEGER REFERENCES works(id),
  type VARCHAR(100),
  description TEXT,
  amount NUMERIC(15,2),
  date DATE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Staff
CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  date DATE,
  status VARCHAR(50),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Staff Plan
CREATE TABLE IF NOT EXISTS staff_plan (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  date DATE,
  plan_type VARCHAR(50),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Employees
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  fio VARCHAR(500),
  role_tag VARCHAR(100),
  position VARCHAR(255),
  phone VARCHAR(100),
  passport_number VARCHAR(50),
  rating_avg NUMERIC(3,1) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Employee Reviews
CREATE TABLE IF NOT EXISTS employee_reviews (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  pm_id INTEGER REFERENCES users(id),
  rating INTEGER,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Employee Plan
CREATE TABLE IF NOT EXISTS employee_plan (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  date DATE,
  work_id INTEGER REFERENCES works(id),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Employee Assignments
CREATE TABLE IF NOT EXISTS employee_assignments (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  work_id INTEGER REFERENCES works(id),
  role VARCHAR(100),
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Employee Permits
CREATE TABLE IF NOT EXISTS employee_permits (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  permit_type VARCHAR(100),
  number VARCHAR(100),
  issued_date DATE,
  expiry_date DATE,
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Customer Reviews
CREATE TABLE IF NOT EXISTS customer_reviews (
  id SERIAL PRIMARY KEY,
  customer_inn VARCHAR(50),
  reviewer_id INTEGER REFERENCES users(id),
  rating INTEGER,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  title VARCHAR(500),
  message TEXT,
  type VARCHAR(50) DEFAULT 'info',
  link VARCHAR(500),
  link_hash VARCHAR(255),
  entity_type VARCHAR(50),
  entity_id INTEGER,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Calendar Events
CREATE TABLE IF NOT EXISTS calendar_events (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500),
  description TEXT,
  date DATE,
  end_date DATE,
  user_id INTEGER REFERENCES users(id),
  type VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Audit Log
CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id),
  entity_type VARCHAR(100),
  entity_id INTEGER,
  action VARCHAR(100),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Correspondence
CREATE TABLE IF NOT EXISTS correspondence (
  id SERIAL PRIMARY KEY,
  number VARCHAR(100),
  type VARCHAR(50),
  date DATE,
  sender VARCHAR(500),
  recipient VARCHAR(500),
  subject TEXT,
  description TEXT,
  status VARCHAR(50),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Travel Expenses
CREATE TABLE IF NOT EXISTS travel_expenses (
  id SERIAL PRIMARY KEY,
  work_id INTEGER REFERENCES works(id),
  type VARCHAR(100),
  description TEXT,
  amount NUMERIC(15,2),
  date DATE,
  status VARCHAR(50) DEFAULT 'pending',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Contracts
CREATE TABLE IF NOT EXISTS contracts (
  id SERIAL PRIMARY KEY,
  number VARCHAR(100),
  date DATE,
  counterparty VARCHAR(500),
  counterparty_inn VARCHAR(50),
  type VARCHAR(100),
  amount NUMERIC(15,2),
  status VARCHAR(50),
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seals
CREATE TABLE IF NOT EXISTS seals (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  number VARCHAR(100),
  type VARCHAR(100),
  holder_id INTEGER REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seal Transfers
CREATE TABLE IF NOT EXISTS seal_transfers (
  id SERIAL PRIMARY KEY,
  seal_id INTEGER REFERENCES seals(id),
  from_user_id INTEGER REFERENCES users(id),
  to_user_id INTEGER REFERENCES users(id),
  date DATE,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Bonus Requests
CREATE TABLE IF NOT EXISTS bonus_requests (
  id SERIAL PRIMARY KEY,
  employee_name VARCHAR(255),
  amount NUMERIC(15,2),
  reason TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  requested_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Work Assign Requests
CREATE TABLE IF NOT EXISTS work_assign_requests (
  id SERIAL PRIMARY KEY,
  work_id INTEGER REFERENCES works(id),
  from_pm_id INTEGER REFERENCES users(id),
  to_pm_id INTEGER REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'pending',
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- PM Consents
CREATE TABLE IF NOT EXISTS pm_consents (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER REFERENCES tenders(id),
  pm_id INTEGER REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'pending',
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Sync Meta
CREATE TABLE IF NOT EXISTS sync_meta (
  table_name VARCHAR(100) PRIMARY KEY,
  last_sync_at TIMESTAMP,
  row_count INTEGER,
  status VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Chats
CREATE TABLE IF NOT EXISTS chats (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  type VARCHAR(50) DEFAULT 'group',
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Chat Group Members
CREATE TABLE IF NOT EXISTS chat_group_members (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  joined_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);

-- Chat Messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id),
  message TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Call History
CREATE TABLE IF NOT EXISTS call_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  phone VARCHAR(100),
  direction VARCHAR(20),
  duration INTEGER,
  status VARCHAR(50),
  recording_url TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- User Call Status
CREATE TABLE IF NOT EXISTS user_call_status (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  status VARCHAR(50) DEFAULT 'available',
  updated_at TIMESTAMP DEFAULT NOW()
);

-- User Dashboard
CREATE TABLE IF NOT EXISTS user_dashboard (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  widgets JSONB DEFAULT '[]',
  layout JSONB DEFAULT '{}',
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Bank Rules
CREATE TABLE IF NOT EXISTS bank_rules (
  id SERIAL PRIMARY KEY,
  pattern VARCHAR(500),
  category VARCHAR(100),
  description TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Staff Requests
CREATE TABLE IF NOT EXISTS staff_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  type VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending',
  data JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Staff Request Messages
CREATE TABLE IF NOT EXISTS staff_request_messages (
  id SERIAL PRIMARY KEY,
  request_id INTEGER REFERENCES staff_requests(id),
  user_id INTEGER REFERENCES users(id),
  message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Staff Replacements
CREATE TABLE IF NOT EXISTS staff_replacements (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  replacement_id INTEGER REFERENCES employees(id),
  date_from DATE,
  date_to DATE,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Purchase Requests
CREATE TABLE IF NOT EXISTS purchase_requests (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500),
  description TEXT,
  amount NUMERIC(15,2),
  status VARCHAR(50) DEFAULT 'pending',
  requested_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- QA Messages
CREATE TABLE IF NOT EXISTS qa_messages (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  message TEXT,
  response TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Doc Sets
CREATE TABLE IF NOT EXISTS doc_sets (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER REFERENCES tenders(id),
  name VARCHAR(255),
  status VARCHAR(50),
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Documents
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  doc_set_id INTEGER REFERENCES doc_sets(id),
  filename VARCHAR(500),
  original_name VARCHAR(500),
  mime_type VARCHAR(100),
  size INTEGER,
  type VARCHAR(50),
  tender_id INTEGER REFERENCES tenders(id),
  work_id INTEGER REFERENCES works(id),
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Acts
CREATE TABLE IF NOT EXISTS acts (
  id SERIAL PRIMARY KEY,
  act_number VARCHAR(100),
  act_date DATE,
  status VARCHAR(50) DEFAULT 'draft',
  work_id INTEGER REFERENCES works(id),
  customer_name VARCHAR(500),
  customer_inn VARCHAR(50),
  description TEXT,
  amount NUMERIC(15,2),
  vat_pct NUMERIC(5,2) DEFAULT 20,
  total_amount NUMERIC(15,2),
  signed_date DATE,
  paid_date DATE,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Invoices
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_number VARCHAR(100),
  invoice_date DATE,
  invoice_type VARCHAR(50),
  status VARCHAR(50) DEFAULT 'draft',
  work_id INTEGER REFERENCES works(id),
  act_id INTEGER REFERENCES acts(id),
  customer_name VARCHAR(500),
  customer_inn VARCHAR(50),
  description TEXT,
  amount NUMERIC(15,2),
  vat_pct NUMERIC(5,2) DEFAULT 20,
  total_amount NUMERIC(15,2),
  due_date DATE,
  paid_amount NUMERIC(15,2) DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Invoice Payments
CREATE TABLE IF NOT EXISTS invoice_payments (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id),
  amount NUMERIC(15,2),
  payment_date DATE,
  comment TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Email History
CREATE TABLE IF NOT EXISTS email_history (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  to_email VARCHAR(255),
  subject VARCHAR(500),
  body TEXT,
  status VARCHAR(50),
  message_id VARCHAR(255),
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Email Queue
CREATE TABLE IF NOT EXISTS email_queue (
  id SERIAL PRIMARY KEY,
  to_email VARCHAR(255),
  subject VARCHAR(500),
  body TEXT,
  html TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  error TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Email Accounts
CREATE TABLE IF NOT EXISTS email_accounts (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE,
  imap_host VARCHAR(255),
  imap_port INTEGER DEFAULT 993,
  smtp_host VARCHAR(255),
  smtp_port INTEGER DEFAULT 587,
  username VARCHAR(255),
  password VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Emails
CREATE TABLE IF NOT EXISTS emails (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES email_accounts(id),
  message_id VARCHAR(255),
  subject VARCHAR(500),
  from_address VARCHAR(255),
  to_address VARCHAR(255),
  body TEXT,
  html TEXT,
  date TIMESTAMP,
  is_read BOOLEAN DEFAULT false,
  folder VARCHAR(100) DEFAULT 'INBOX',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Reminders
CREATE TABLE IF NOT EXISTS reminders (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  title VARCHAR(500),
  description TEXT,
  remind_at TIMESTAMP,
  entity_type VARCHAR(50),
  entity_id INTEGER,
  is_done BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Equipment
CREATE TABLE IF NOT EXISTS equipment (
  id SERIAL PRIMARY KEY,
  name VARCHAR(500),
  inventory_number VARCHAR(100),
  serial_number VARCHAR(100),
  category_id INTEGER,
  status VARCHAR(50) DEFAULT 'available',
  warehouse_id INTEGER,
  current_holder_id INTEGER REFERENCES users(id),
  current_object_id INTEGER,
  purchase_date DATE,
  purchase_price NUMERIC(15,2),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Equipment Categories
CREATE TABLE IF NOT EXISTS equipment_categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  icon VARCHAR(50),
  code VARCHAR(50),
  is_consumable BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0
);

-- Warehouses
CREATE TABLE IF NOT EXISTS warehouses (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  address TEXT,
  responsible_id INTEGER REFERENCES users(id),
  is_active BOOLEAN DEFAULT true,
  is_main BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Objects (sites/locations)
CREATE TABLE IF NOT EXISTS objects (
  id SERIAL PRIMARY KEY,
  name VARCHAR(500),
  address TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Equipment Movements
CREATE TABLE IF NOT EXISTS equipment_movements (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER REFERENCES equipment(id),
  type VARCHAR(50),
  from_warehouse_id INTEGER,
  to_warehouse_id INTEGER,
  from_holder_id INTEGER REFERENCES users(id),
  to_holder_id INTEGER REFERENCES users(id),
  from_object_id INTEGER,
  to_object_id INTEGER,
  reason TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Equipment Requests
CREATE TABLE IF NOT EXISTS equipment_requests (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER REFERENCES equipment(id),
  work_id INTEGER,
  type VARCHAR(50),
  status VARCHAR(50) DEFAULT 'pending',
  requested_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Equipment Reservations
CREATE TABLE IF NOT EXISTS equipment_reservations (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER REFERENCES equipment(id),
  work_id INTEGER,
  reserved_by INTEGER REFERENCES users(id),
  reserved_from DATE,
  reserved_to DATE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Equipment Maintenance
CREATE TABLE IF NOT EXISTS equipment_maintenance (
  id SERIAL PRIMARY KEY,
  equipment_id INTEGER REFERENCES equipment(id),
  type VARCHAR(100),
  description TEXT,
  cost NUMERIC(15,2),
  performed_by INTEGER REFERENCES users(id),
  performed_at DATE,
  next_maintenance DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  description TEXT,
  status VARCHAR(50) DEFAULT 'new',
  priority VARCHAR(20) DEFAULT 'medium',
  assigned_to INTEGER REFERENCES users(id),
  created_by INTEGER REFERENCES users(id),
  due_date DATE,
  completed_at TIMESTAMP,
  accepted_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Cash Advances
CREATE TABLE IF NOT EXISTS cash_advances (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  amount NUMERIC(15,2),
  purpose TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMP,
  report_submitted BOOLEAN DEFAULT false,
  report_data JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Saved Reports
CREATE TABLE IF NOT EXISTS saved_reports (
  id SERIAL PRIMARY KEY,
  type VARCHAR(100),
  period VARCHAR(50),
  period_code VARCHAR(20),
  data JSONB,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Seed admin user
INSERT INTO users (login, password_hash, name, email, role, is_active, pin_hash)
VALUES ('admin', '$2b$10$XQxBj9bLlHdEj/LsSqKTdunVn9fDsR66U3V1BbqxNUfSdjDHMFhEq', 'Администратор', 'admin@asgard.ru', 'ADMIN', true, '$2b$10$XQxBj9bLlHdEj/LsSqKTdunVn9fDsR66U3V1BbqxNUfSdjDHMFhEq')
ON CONFLICT (login) DO NOTHING;

-- Seed default settings
INSERT INTO settings (key, value_json) VALUES
('refs', '{"tender_statuses":["Черновик","Новый","В работе","Отправлено на просчёт","Согласование ТКП","ТКП согласовано","Выиграли","Проиграли","Контракт","Клиент отказался","Клиент согласился","Отказ"],"reject_reasons":["Цена","Сроки","Качество","Другое"]}')
ON CONFLICT (key) DO NOTHING;
