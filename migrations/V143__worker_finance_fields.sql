-- ═══════════════════════════════════════════════════════════════════════════
-- HR Module v2 — Сессия 1, Шаг 1, Волна 3
-- V143: Финансовые поля рабочих + операции с самозанятыми (se_transfers)
--
-- Взаимоисключение: рабочий не может быть одновременно СЗ и официально устроенным.
-- Годовой лимит НПД считаем динамически по se_transfers (не храним в employees).
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Самозанятость ──────────────────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_self_employed BOOLEAN DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS can_exceed_limit BOOLEAN DEFAULT false;

-- ─── Официальное трудоустройство ────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_officially_employed BOOLEAN DEFAULT false;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS official_salary NUMERIC(12,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS official_non_burnable NUMERIC(12,2);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS official_hire_date DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS official_status VARCHAR(20) DEFAULT 'active'
  CHECK (official_status IN ('active', 'unpaid_leave', 'maternity', 'sick_leave', 'fired'));
ALTER TABLE employees ADD COLUMN IF NOT EXISTS official_leave_from DATE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS official_leave_to DATE;

-- Взаимоисключение режимов
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_employment_mode'
  ) THEN
    ALTER TABLE employees ADD CONSTRAINT chk_employment_mode
      CHECK (NOT (is_self_employed = true AND is_officially_employed = true));
  END IF;
END $$;

-- ─── Журнал начислений по официально устроенным ────────────────────────────
CREATE TABLE IF NOT EXISTS official_salary_log (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  salary_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  earned_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  deducted_from_earned NUMERIC(12,2) DEFAULT 0,
  non_burnable_amount NUMERIC(12,2) DEFAULT 0,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'calculated', 'paid')),
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, year, month)
);
CREATE INDEX IF NOT EXISTS idx_osl_emp_period ON official_salary_log(employee_id, year, month);

-- ─── Операции с самозанятыми (единый журнал) ────────────────────────────────
CREATE TABLE IF NOT EXISTS se_transfers (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id),

  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),

  operation_type VARCHAR(30) NOT NULL CHECK (operation_type IN (
    'work_transfer',
    'agreement_transfer'
  )),

  earned_amount NUMERIC(12,2) DEFAULT 0,
  transfer_amount NUMERIC(12,2) NOT NULL,
  cash_return_amount NUMERIC(12,2) DEFAULT 0,
  cash_payout_amount NUMERIC(12,2) DEFAULT 0,

  work_id INTEGER REFERENCES works(id),

  status VARCHAR(20) DEFAULT 'planned' CHECK (status IN (
    'planned',
    'transferred',
    'returned',
    'completed',
    'cancelled'
  )),

  transferred_at TIMESTAMPTZ,
  returned_at TIMESTAMPTZ,

  comment TEXT,
  created_by INTEGER REFERENCES users(id),
  confirmed_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- pm_user_id для быстрого баланса РП без JOIN через works
ALTER TABLE se_transfers ADD COLUMN IF NOT EXISTS pm_user_id INTEGER REFERENCES users(id);

-- ИНН самозанятого на момент операции (snapshot, на случай смены)
ALTER TABLE se_transfers ADD COLUMN IF NOT EXISTS inn VARCHAR(12);

CREATE INDEX IF NOT EXISTS idx_se_transfers_emp ON se_transfers(employee_id, year, month);
CREATE INDEX IF NOT EXISTS idx_se_transfers_status ON se_transfers(status) WHERE status != 'cancelled';
CREATE INDEX IF NOT EXISTS idx_se_transfers_year ON se_transfers(year, employee_id);
CREATE INDEX IF NOT EXISTS idx_se_transfers_pm ON se_transfers(pm_user_id, year, month);
