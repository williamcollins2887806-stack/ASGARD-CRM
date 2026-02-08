-- ============================================================
-- V015: Расчёты с рабочими + Самозанятые + Такси/Топливо
-- Фаза 4 маршрутной карты: требования №29-34
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- 1. Дневные ставки рабочих
-- Хранит историю ставок. Текущая = effective_to IS NULL
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS employee_rates (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  role_tag VARCHAR(100),
  day_rate NUMERIC(12,2) NOT NULL,
  shift_rate NUMERIC(12,2),
  overtime_rate NUMERIC(12,2),
  effective_from DATE DEFAULT CURRENT_DATE,
  effective_to DATE,
  comment TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────
-- 2. Расчётные ведомости (заголовки)
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_sheets (
  id SERIAL PRIMARY KEY,
  work_id INTEGER REFERENCES works(id),
  title TEXT NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  status VARCHAR(30) DEFAULT 'draft',
  total_accrued NUMERIC(15,2) DEFAULT 0,
  total_bonus NUMERIC(15,2) DEFAULT 0,
  total_penalty NUMERIC(15,2) DEFAULT 0,
  total_advance_paid NUMERIC(15,2) DEFAULT 0,
  total_payout NUMERIC(15,2) DEFAULT 0,
  workers_count INTEGER DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMP,
  paid_by INTEGER REFERENCES users(id),
  paid_at TIMESTAMP,
  comment TEXT,
  director_comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────
-- 3. Строки начислений
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payroll_items (
  id SERIAL PRIMARY KEY,
  sheet_id INTEGER REFERENCES payroll_sheets(id) ON DELETE CASCADE,
  employee_id INTEGER REFERENCES employees(id),
  employee_name TEXT,
  work_id INTEGER REFERENCES works(id),
  role_on_work VARCHAR(100),
  days_worked INTEGER DEFAULT 0,
  day_rate NUMERIC(12,2) DEFAULT 0,
  base_amount NUMERIC(15,2) DEFAULT 0,
  bonus NUMERIC(15,2) DEFAULT 0,
  overtime_hours NUMERIC(8,2) DEFAULT 0,
  overtime_amount NUMERIC(15,2) DEFAULT 0,
  penalty NUMERIC(15,2) DEFAULT 0,
  penalty_reason TEXT,
  advance_paid NUMERIC(15,2) DEFAULT 0,
  deductions NUMERIC(15,2) DEFAULT 0,
  deductions_reason TEXT,
  accrued NUMERIC(15,2) DEFAULT 0,
  payout NUMERIC(15,2) DEFAULT 0,
  payment_method VARCHAR(30) DEFAULT 'card',
  is_self_employed BOOLEAN DEFAULT false,
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────
-- 4. Реестр выплат
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_registry (
  id SERIAL PRIMARY KEY,
  sheet_id INTEGER REFERENCES payroll_sheets(id),
  employee_id INTEGER REFERENCES employees(id),
  employee_name TEXT,
  amount NUMERIC(15,2) NOT NULL,
  payment_type VARCHAR(30) DEFAULT 'salary',
  payment_method VARCHAR(30) DEFAULT 'card',
  inn VARCHAR(20),
  bank_name TEXT,
  bik VARCHAR(20),
  account_number VARCHAR(30),
  status VARCHAR(30) DEFAULT 'pending',
  paid_at TIMESTAMP,
  bank_ref TEXT,
  payment_order_number TEXT,
  comment TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────
-- 5. Самозанятые
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS self_employed (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  inn VARCHAR(12) NOT NULL,
  phone VARCHAR(50),
  email VARCHAR(255),
  bank_name TEXT,
  bik VARCHAR(20),
  corr_account VARCHAR(30),
  account_number VARCHAR(30),
  card_number VARCHAR(20),
  npd_status VARCHAR(30) DEFAULT 'active',
  npd_registered_at DATE,
  contract_number TEXT,
  contract_date DATE,
  contract_end_date DATE,
  comment TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────
-- 6. Разовые оплаты
-- ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS one_time_payments (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  employee_name TEXT,
  work_id INTEGER REFERENCES works(id),
  amount NUMERIC(15,2) NOT NULL,
  reason TEXT NOT NULL,
  payment_method VARCHAR(30) DEFAULT 'card',
  payment_type VARCHAR(30) DEFAULT 'one_time',
  status VARCHAR(30) DEFAULT 'pending',
  requested_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  approved_at TIMESTAMP,
  paid_at TIMESTAMP,
  comment TEXT,
  director_comment TEXT,
  receipt_url TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ───────────────────────────────────────────────────────────
-- 7. Расширение таблицы employees
-- ───────────────────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_self_employed BOOLEAN DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS inn VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS snils VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS bik VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS account_number VARCHAR(30);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS card_number VARCHAR(20);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS passport_series VARCHAR(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS passport_number VARCHAR(10);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS day_rate NUMERIC(12,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS contract_type VARCHAR(30) DEFAULT 'labor';

-- ───────────────────────────────────────────────────────────
-- 8. Индексы
-- ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_employee_rates_emp ON employee_rates(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_rates_active ON employee_rates(employee_id) WHERE effective_to IS NULL;
CREATE INDEX IF NOT EXISTS idx_payroll_sheets_work ON payroll_sheets(work_id);
CREATE INDEX IF NOT EXISTS idx_payroll_sheets_status ON payroll_sheets(status);
CREATE INDEX IF NOT EXISTS idx_payroll_sheets_period ON payroll_sheets(period_from, period_to);
CREATE INDEX IF NOT EXISTS idx_payroll_items_sheet ON payroll_items(sheet_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_employee ON payroll_items(employee_id);
CREATE INDEX IF NOT EXISTS idx_payment_registry_sheet ON payment_registry(sheet_id);
CREATE INDEX IF NOT EXISTS idx_payment_registry_status ON payment_registry(status);
CREATE INDEX IF NOT EXISTS idx_payment_registry_employee ON payment_registry(employee_id);
CREATE INDEX IF NOT EXISTS idx_self_employed_inn ON self_employed(inn);
CREATE INDEX IF NOT EXISTS idx_self_employed_employee ON self_employed(employee_id);
CREATE INDEX IF NOT EXISTS idx_one_time_status ON one_time_payments(status);
CREATE INDEX IF NOT EXISTS idx_one_time_employee ON one_time_payments(employee_id);
CREATE INDEX IF NOT EXISTS idx_one_time_work ON one_time_payments(work_id);
