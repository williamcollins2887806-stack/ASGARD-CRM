-- ASGARD CRM Initial Schema
-- ═══════════════════════════════════════════════════════════════════════════

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  login VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255),
  role VARCHAR(50) DEFAULT 'USER',
  email VARCHAR(255),
  phone VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  last_login TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Settings table
CREATE TABLE IF NOT EXISTS settings (
  key VARCHAR(100) PRIMARY KEY,
  value_json TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Tenders table
CREATE TABLE IF NOT EXISTS tenders (
  id SERIAL PRIMARY KEY,
  period VARCHAR(20),
  customer_name VARCHAR(255),
  customer_inn VARCHAR(20),
  tender_title TEXT,
  tender_type VARCHAR(100),
  tender_status VARCHAR(100) DEFAULT 'Новый',
  docs_deadline DATE,
  tender_price NUMERIC(15,2),
  work_start_plan DATE,
  work_end_plan DATE,
  responsible_pm_id INTEGER REFERENCES users(id),
  distribution_requested_at TIMESTAMP,
  handoff_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Estimates table
CREATE TABLE IF NOT EXISTS estimates (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER REFERENCES tenders(id),
  pm_id INTEGER REFERENCES users(id),
  version_no INTEGER DEFAULT 1,
  probability_pct INTEGER,
  cost_plan NUMERIC(15,2),
  price_tkp NUMERIC(15,2),
  payment_terms TEXT,
  comment TEXT,
  cover_letter TEXT,
  assumptions TEXT,
  approval_status VARCHAR(50) DEFAULT 'draft',
  sent_for_approval_at TIMESTAMP,
  decided_at TIMESTAMP,
  approval_comment TEXT,
  calc_summary_json TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Works table
CREATE TABLE IF NOT EXISTS works (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER REFERENCES tenders(id),
  pm_id INTEGER REFERENCES users(id),
  company VARCHAR(255),
  work_title TEXT,
  work_status VARCHAR(100) DEFAULT 'Подготовка',
  start_in_work_date DATE,
  end_plan DATE,
  end_fact DATE,
  contract_value NUMERIC(15,2),
  advance_pct INTEGER,
  cost_plan NUMERIC(15,2),
  cost_fact NUMERIC(15,2),
  closed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Employees table
CREATE TABLE IF NOT EXISTS employees (
  id SERIAL PRIMARY KEY,
  fio VARCHAR(255) NOT NULL,
  role_tag VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  phone VARCHAR(50),
  email VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Work expenses table
CREATE TABLE IF NOT EXISTS work_expenses (
  id SERIAL PRIMARY KEY,
  work_id INTEGER REFERENCES works(id),
  category VARCHAR(100),
  amount NUMERIC(15,2),
  date DATE,
  employee_id INTEGER REFERENCES employees(id),
  comment TEXT,
  bonus_request_id INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Bonus requests table
CREATE TABLE IF NOT EXISTS bonus_requests (
  id SERIAL PRIMARY KEY,
  work_id INTEGER REFERENCES works(id),
  work_title TEXT,
  pm_id INTEGER REFERENCES users(id),
  bonuses_json TEXT,
  total_amount NUMERIC(15,2),
  comment TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  director_comment TEXT,
  processed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Other supporting tables (minimal definitions)
CREATE TABLE IF NOT EXISTS customers (
  inn VARCHAR(20) PRIMARY KEY,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  message TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  action VARCHAR(100),
  table_name VARCHAR(100),
  record_id INTEGER,
  changes_json TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert admin user (password: Orion2025!)
INSERT INTO users (login, password_hash, name, role, is_active)
VALUES ('admin', '$2a$10$qmfcPeBvIPHLn3JWlVv4teLGkWzphqYEqpxBdoYM07WAqTwS1XE72', 'Администратор', 'ADMIN', true)
ON CONFLICT (login) DO NOTHING;
