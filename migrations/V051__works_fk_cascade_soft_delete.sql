-- ═══════════════════════════════════════════════════════════════
-- V051: FK CASCADE/SET NULL + soft delete support
-- Закрывает: D10, B3, A1
-- ═══════════════════════════════════════════════════════════════

-- A1: Soft delete columns (already added in V050, ensure they exist)
ALTER TABLE works ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE works ADD COLUMN IF NOT EXISTS deleted_by integer;

-- ═══════════════════════════════════════════════════════════════
-- D10: Update existing FK constraints from NO ACTION to CASCADE/SET NULL
-- Принцип: операционные данные = CASCADE, финансовые/архивные = SET NULL
-- ═══════════════════════════════════════════════════════════════

-- === CASCADE (удаляются вместе с работой) ===

-- employee_plan: графики привязаны к работе
ALTER TABLE employee_plan DROP CONSTRAINT IF EXISTS employee_plan_work_id_fkey;
ALTER TABLE employee_plan ADD CONSTRAINT employee_plan_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;

-- employee_reviews: оценки сотрудников на работе
ALTER TABLE employee_reviews DROP CONSTRAINT IF EXISTS employee_reviews_work_id_fkey;
ALTER TABLE employee_reviews ADD CONSTRAINT employee_reviews_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;

-- === SET NULL (запись сохраняется, ссылка обнуляется) ===

-- bank_transactions
ALTER TABLE bank_transactions DROP CONSTRAINT IF EXISTS bank_transactions_work_id_fkey;
ALTER TABLE bank_transactions ADD CONSTRAINT bank_transactions_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- calendar_events
ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_work_id_fkey;
ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- cash_requests
ALTER TABLE cash_requests DROP CONSTRAINT IF EXISTS cash_requests_work_id_fkey;
ALTER TABLE cash_requests ADD CONSTRAINT cash_requests_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- correspondence
ALTER TABLE correspondence DROP CONSTRAINT IF EXISTS correspondence_work_id_fkey;
ALTER TABLE correspondence ADD CONSTRAINT correspondence_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- documents
ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_work_id_fkey;
ALTER TABLE documents ADD CONSTRAINT documents_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- inbox_applications (linked_work_id)
ALTER TABLE inbox_applications DROP CONSTRAINT IF EXISTS inbox_applications_linked_work_id_fkey;
ALTER TABLE inbox_applications ADD CONSTRAINT inbox_applications_linked_work_id_fkey
  FOREIGN KEY (linked_work_id) REFERENCES works(id) ON DELETE SET NULL;

-- incomes
ALTER TABLE incomes DROP CONSTRAINT IF EXISTS incomes_work_id_fkey;
ALTER TABLE incomes ADD CONSTRAINT incomes_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- meetings
ALTER TABLE meetings DROP CONSTRAINT IF EXISTS meetings_work_id_fkey;
ALTER TABLE meetings ADD CONSTRAINT meetings_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- one_time_payments
ALTER TABLE one_time_payments DROP CONSTRAINT IF EXISTS one_time_payments_work_id_fkey;
ALTER TABLE one_time_payments ADD CONSTRAINT one_time_payments_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- payroll_items
ALTER TABLE payroll_items DROP CONSTRAINT IF EXISTS payroll_items_work_id_fkey;
ALTER TABLE payroll_items ADD CONSTRAINT payroll_items_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- payroll_sheets
ALTER TABLE payroll_sheets DROP CONSTRAINT IF EXISTS payroll_sheets_work_id_fkey;
ALTER TABLE payroll_sheets ADD CONSTRAINT payroll_sheets_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- tasks
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_work_id_fkey;
ALTER TABLE tasks ADD CONSTRAINT tasks_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- travel_expenses
ALTER TABLE travel_expenses DROP CONSTRAINT IF EXISTS travel_expenses_work_id_fkey;
ALTER TABLE travel_expenses ADD CONSTRAINT travel_expenses_work_id_fkey
  FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;

-- ═══════════════════════════════════════════════════════════════
-- Add missing FK for tables that have work_id but no constraint
-- ═══════════════════════════════════════════════════════════════

-- customer_reviews: CASCADE (оценки заказчика привязаны к работе)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customer_reviews_work_id_fkey') THEN
    ALTER TABLE customer_reviews ADD CONSTRAINT customer_reviews_work_id_fkey
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;
  END IF;
END $$;

-- staff_requests: CASCADE (заявки на персонал привязаны к работе)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'staff_requests_work_id_fkey') THEN
    ALTER TABLE staff_requests ADD CONSTRAINT staff_requests_work_id_fkey
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;
  END IF;
END $$;

-- acts: SET NULL (финансовый документ)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acts_work_id_fkey') THEN
    ALTER TABLE acts ADD CONSTRAINT acts_work_id_fkey
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;
  END IF;
END $$;

-- invoices: SET NULL (финансовый документ)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invoices_work_id_fkey') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_work_id_fkey
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;
  END IF;
END $$;

-- contracts: SET NULL (договор может пережить удаление работы)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contracts_work_id_fkey') THEN
    ALTER TABLE contracts ADD CONSTRAINT contracts_work_id_fkey
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;
  END IF;
END $$;

-- estimates: SET NULL (расчёт может пережить удаление работы)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'estimates_work_id_fkey') THEN
    ALTER TABLE estimates ADD CONSTRAINT estimates_work_id_fkey
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE SET NULL;
  END IF;
END $$;

-- employee_assignments: CASCADE (привязка сотрудника к работе)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'employee_assignments_work_id_fkey') THEN
    ALTER TABLE employee_assignments ADD CONSTRAINT employee_assignments_work_id_fkey
      FOREIGN KEY (work_id) REFERENCES works(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- Index for soft delete filtering performance
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_works_deleted_at ON works(deleted_at) WHERE deleted_at IS NOT NULL;
