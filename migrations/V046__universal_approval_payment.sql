-- ═══════════════════════════════════════════════════════════════════
-- V046: Универсальное согласование с маршрутом оплаты
-- 
-- Добавляет к 12 сущностям единый набор полей:
--   requires_payment  — нужна ли оплата (инициатор ставит)
--   payment_method    — способ оплаты: 'bank_transfer' | 'cash'
--   payment_status    — этап оплаты
--   payment_comment   — комментарий бухгалтерии
--   payment_doc_id    — FK на documents (платёжка/ПП)
--   buh_id            — кто из бухгалтерии обработал
--   buh_acted_at      — когда бухгалтерия обработала
--
-- Маршрут:
--   requires_payment=false: директор→Согласовать→готово
--   requires_payment=true:  директор→Согласовать→бухгалтерия→
--     ├─ ПП:      payment_method='bank_transfer', прикладывает ПП → Оплачено
--     └─ Наличные: payment_method='cash', сумма из кассы → инициатор подтверждает → отчитывается
-- ═══════════════════════════════════════════════════════════════════

-- cash_requests — уже имеет свой flow, добавляем только requires_payment
ALTER TABLE cash_requests
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT true;
-- У кассы requires_payment по умолчанию true — это всегда про деньги

-- pre_tender_requests  
ALTER TABLE pre_tender_requests
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_doc_id INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS buh_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS buh_acted_at TIMESTAMP;
-- Расширяем CHECK — добавляем новые статусы
ALTER TABLE pre_tender_requests DROP CONSTRAINT IF EXISTS pre_tender_requests_status_check;
ALTER TABLE pre_tender_requests ADD CONSTRAINT pre_tender_requests_status_check
  CHECK (status IN ('new','in_review','need_docs','accepted','rejected','expired',
                    'pending_approval','approved','pending_payment','paid','cash_issued',
                    'cash_received','expense_reported'));

-- bonus_requests
ALTER TABLE bonus_requests
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_doc_id INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS buh_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS buh_acted_at TIMESTAMP;

-- work_expenses — уже есть requires_approval, approval_status
ALTER TABLE work_expenses
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_doc_id INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS buh_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS buh_acted_at TIMESTAMP;

-- office_expenses — уже есть payment_method и payment_date, не конфликтуем
ALTER TABLE office_expenses
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_doc_id INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS buh_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS buh_acted_at TIMESTAMP;
-- office_expenses.payment_method уже существует — используем его

-- expenses
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_doc_id INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS buh_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS buh_acted_at TIMESTAMP;

-- one_time_payments — уже есть payment_method
ALTER TABLE one_time_payments
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_doc_id INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS buh_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS buh_acted_at TIMESTAMP;

-- tmc_requests
ALTER TABLE tmc_requests
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_doc_id INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS buh_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS buh_acted_at TIMESTAMP;

-- payroll_sheets
ALTER TABLE payroll_sheets
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_doc_id INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS buh_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS buh_acted_at TIMESTAMP;

-- business_trips
ALTER TABLE business_trips
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_doc_id INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS buh_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS buh_acted_at TIMESTAMP;

-- travel_expenses
ALTER TABLE travel_expenses
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_doc_id INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS buh_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS buh_acted_at TIMESTAMP;

-- training_applications
ALTER TABLE training_applications
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20),
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS payment_comment TEXT,
  ADD COLUMN IF NOT EXISTS payment_doc_id INTEGER REFERENCES documents(id),
  ADD COLUMN IF NOT EXISTS buh_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS buh_acted_at TIMESTAMP;

-- ═══════════════════════════════════════════════════════════════════
-- Индексы для быстрой выборки «что ждёт бухгалтерию»
-- ═══════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_bonus_requests_payment ON bonus_requests(payment_status) WHERE requires_payment = true;
CREATE INDEX IF NOT EXISTS idx_work_expenses_payment ON work_expenses(payment_status) WHERE requires_payment = true;
CREATE INDEX IF NOT EXISTS idx_office_expenses_payment ON office_expenses(payment_status) WHERE requires_payment = true;
CREATE INDEX IF NOT EXISTS idx_one_time_payments_payment ON one_time_payments(payment_status) WHERE requires_payment = true;
CREATE INDEX IF NOT EXISTS idx_payroll_sheets_payment ON payroll_sheets(payment_status) WHERE requires_payment = true;
CREATE INDEX IF NOT EXISTS idx_tmc_requests_payment ON tmc_requests(payment_status) WHERE requires_payment = true;
CREATE INDEX IF NOT EXISTS idx_business_trips_payment ON business_trips(payment_status) WHERE requires_payment = true;
CREATE INDEX IF NOT EXISTS idx_travel_expenses_payment ON travel_expenses(payment_status) WHERE requires_payment = true;
CREATE INDEX IF NOT EXISTS idx_training_apps_payment ON training_applications(payment_status) WHERE requires_payment = true;
CREATE INDEX IF NOT EXISTS idx_pre_tenders_payment ON pre_tender_requests(payment_status) WHERE requires_payment = true;
CREATE INDEX IF NOT EXISTS idx_expenses_payment ON expenses(payment_status) WHERE requires_payment = true;
