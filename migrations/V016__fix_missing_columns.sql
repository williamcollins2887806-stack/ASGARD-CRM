-- ============================================================
-- V016: Добавление недостающих столбцов
-- Исправление расхождений между миграциями и frontend
-- ============================================================

-- ───────────────────────────────────────────────────────────
-- 1. travel_expenses — frontend (travel.js) использует
--    расходы по-штучно, а не по-командировкам
-- ───────────────────────────────────────────────────────────
ALTER TABLE travel_expenses ADD COLUMN IF NOT EXISTS expense_type VARCHAR(100);
ALTER TABLE travel_expenses ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE travel_expenses ADD COLUMN IF NOT EXISTS amount NUMERIC(15,2);
ALTER TABLE travel_expenses ADD COLUMN IF NOT EXISTS work_id INTEGER;
ALTER TABLE travel_expenses ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE travel_expenses ADD COLUMN IF NOT EXISTS supplier TEXT;
ALTER TABLE travel_expenses ADD COLUMN IF NOT EXISTS doc_number VARCHAR(100);
ALTER TABLE travel_expenses ADD COLUMN IF NOT EXISTS date_from DATE;
ALTER TABLE travel_expenses ADD COLUMN IF NOT EXISTS date_to DATE;
ALTER TABLE travel_expenses ADD COLUMN IF NOT EXISTS created_by INTEGER;
ALTER TABLE travel_expenses ADD COLUMN IF NOT EXISTS comment TEXT;

-- ───────────────────────────────────────────────────────────
-- 2. incomes — frontend (kpi_money.js, bank_import.js)
--    использует counterparty, comment, confirmed
-- ───────────────────────────────────────────────────────────
ALTER TABLE incomes ADD COLUMN IF NOT EXISTS counterparty TEXT;
ALTER TABLE incomes ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE incomes ADD COLUMN IF NOT EXISTS confirmed BOOLEAN DEFAULT true;
ALTER TABLE incomes ADD COLUMN IF NOT EXISTS source VARCHAR(50);
ALTER TABLE incomes ADD COLUMN IF NOT EXISTS import_hash TEXT;

-- ───────────────────────────────────────────────────────────
-- 3. office_expenses — frontend (office_expenses.js,
--    bank_import.js, receipt_scanner.js)
-- ───────────────────────────────────────────────────────────
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS supplier TEXT;
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS doc_number VARCHAR(100);
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS contract_id INTEGER;
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS invoice_needed BOOLEAN DEFAULT false;
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS invoice_received BOOLEAN DEFAULT false;
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMP;
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS counterparty TEXT;
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS work_id INTEGER;
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS source VARCHAR(50);
ALTER TABLE office_expenses ADD COLUMN IF NOT EXISTS import_hash TEXT;

-- ───────────────────────────────────────────────────────────
-- 4. work_expenses — frontend (receipt_scanner.js,
--    bank_import.js) использует supplier, counterparty
-- ───────────────────────────────────────────────────────────
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS supplier TEXT;
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS counterparty TEXT;
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS source VARCHAR(50);
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS import_hash TEXT;

-- ───────────────────────────────────────────────────────────
-- 5. Индексы
-- ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_travel_expenses_work ON travel_expenses(work_id);
CREATE INDEX IF NOT EXISTS idx_travel_expenses_date ON travel_expenses(date);
CREATE INDEX IF NOT EXISTS idx_travel_expenses_emp ON travel_expenses(employee_id);
CREATE INDEX IF NOT EXISTS idx_incomes_work ON incomes(work_id);
CREATE INDEX IF NOT EXISTS idx_incomes_date ON incomes(date);
CREATE INDEX IF NOT EXISTS idx_incomes_hash ON incomes(import_hash);
CREATE INDEX IF NOT EXISTS idx_office_expenses_date ON office_expenses(date);
CREATE INDEX IF NOT EXISTS idx_office_expenses_status ON office_expenses(status);
CREATE INDEX IF NOT EXISTS idx_office_expenses_hash ON office_expenses(import_hash);
