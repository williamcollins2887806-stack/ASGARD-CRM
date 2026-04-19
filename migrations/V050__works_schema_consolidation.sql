-- ═══════════════════════════════════════════════════════════════
-- V050: Консолидация схемы works — удаление дублирующихся колонок
-- ═══════════════════════════════════════════════════════════════
-- ПЕРЕД ЗАПУСКОМ: pg_dump -t works > works_backup_before_v050.sql
--
-- Маппинг дублей → канонические:
--   contract_sum        → contract_value
--   advance_percent     → advance_pct
--   w_adv_pct           → advance_pct
--   advance_sum         → advance_received
--   balance_sum         → balance_received
--   status              → work_status
--   work_name           → work_title
--   end_date_plan       → end_plan
--   end_date_fact       → end_fact
--   start_date_plan     → start_plan
--   work_start_plan     → start_plan  (в works; в tenders остаётся)
--   work_end_plan       → end_plan    (в works; в tenders остаётся)
--   advance_date_plan   → (мёртвая, DROP)
--   payment_date_plan   → (мёртвая, DROP)
--   responsible_pm_id   → pm_id       (в works; в tenders остаётся)
-- ═══════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────
-- 1. Добавить недостающие колонки (если ещё нет)
-- ───────────────────────────────────────────────────────────────
ALTER TABLE works ADD COLUMN IF NOT EXISTS delay_workdays integer;
ALTER TABLE works ADD COLUMN IF NOT EXISTS crew_size integer;
ALTER TABLE works ADD COLUMN IF NOT EXISTS deleted_at timestamp;
ALTER TABLE works ADD COLUMN IF NOT EXISTS deleted_by integer;

-- ───────────────────────────────────────────────────────────────
-- 2. Перенести данные из дублей в канонические колонки
--    (COALESCE: каноничная имеет приоритет, дубль — fallback)
-- ───────────────────────────────────────────────────────────────
UPDATE works SET contract_value = COALESCE(contract_value, contract_sum)
  WHERE contract_value IS NULL AND contract_sum IS NOT NULL;

UPDATE works SET advance_pct = COALESCE(advance_pct, advance_percent, w_adv_pct)
  WHERE advance_pct IS NULL AND (advance_percent IS NOT NULL OR w_adv_pct IS NOT NULL);

UPDATE works SET advance_received = COALESCE(advance_received, advance_sum)
  WHERE advance_received IS NULL AND advance_sum IS NOT NULL;

UPDATE works SET balance_received = COALESCE(balance_received, balance_sum)
  WHERE balance_received IS NULL AND balance_sum IS NOT NULL;

UPDATE works SET work_status = COALESCE(work_status, status)
  WHERE work_status IS NULL AND status IS NOT NULL;

UPDATE works SET work_title = COALESCE(work_title, work_name)
  WHERE work_title IS NULL AND work_name IS NOT NULL;

UPDATE works SET end_plan = COALESCE(end_plan, end_date_plan, work_end_plan)
  WHERE end_plan IS NULL AND (end_date_plan IS NOT NULL OR work_end_plan IS NOT NULL);

UPDATE works SET end_fact = COALESCE(end_fact, end_date_fact)
  WHERE end_fact IS NULL AND end_date_fact IS NOT NULL;

UPDATE works SET start_plan = COALESCE(start_plan, start_date_plan, work_start_plan)
  WHERE start_plan IS NULL AND (start_date_plan IS NOT NULL OR work_start_plan IS NOT NULL);

UPDATE works SET pm_id = COALESCE(pm_id, responsible_pm_id)
  WHERE pm_id IS NULL AND responsible_pm_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────
-- 3. DROP дублирующихся колонок
-- ───────────────────────────────────────────────────────────────

-- Группа A: мёртвые колонки (0 использований в коде)
ALTER TABLE works DROP COLUMN IF EXISTS advance_percent;
ALTER TABLE works DROP COLUMN IF EXISTS advance_sum;
ALTER TABLE works DROP COLUMN IF EXISTS balance_sum;
ALTER TABLE works DROP COLUMN IF EXISTS end_date_fact;
ALTER TABLE works DROP COLUMN IF EXISTS advance_date_plan;
ALTER TABLE works DROP COLUMN IF EXISTS payment_date_plan;

-- Группа B: дубли с использованиями (код обновлён в этом же коммите)
ALTER TABLE works DROP COLUMN IF EXISTS contract_sum;
ALTER TABLE works DROP COLUMN IF EXISTS w_adv_pct;
ALTER TABLE works DROP COLUMN IF EXISTS status;
ALTER TABLE works DROP COLUMN IF EXISTS work_name;
ALTER TABLE works DROP COLUMN IF EXISTS end_date_plan;
ALTER TABLE works DROP COLUMN IF EXISTS start_date_plan;
ALTER TABLE works DROP COLUMN IF EXISTS work_start_plan;
ALTER TABLE works DROP COLUMN IF EXISTS work_end_plan;
ALTER TABLE works DROP COLUMN IF EXISTS responsible_pm_id;

-- ───────────────────────────────────────────────────────────────
-- 4. Удалить дубли индексов
-- ───────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_works_work_status;
-- idx_works_status остаётся (каноничный)

-- ───────────────────────────────────────────────────────────────
-- 5. Другие таблицы: добавить недостающие колонки
-- ───────────────────────────────────────────────────────────────

-- staff_requests: колонки для вахтового режима (A/B смены)
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS proposed_staff_ids_a_json jsonb;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS proposed_staff_ids_b_json jsonb;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS approved_staff_ids_a_json jsonb;
ALTER TABLE staff_requests ADD COLUMN IF NOT EXISTS approved_staff_ids_b_json jsonb;

-- staff_replacements: недостающие колонки
ALTER TABLE staff_replacements ADD COLUMN IF NOT EXISTS dates_json jsonb;
ALTER TABLE staff_replacements ADD COLUMN IF NOT EXISTS comment text;
ALTER TABLE staff_replacements ADD COLUMN IF NOT EXISTS crew varchar(1);
ALTER TABLE staff_replacements ADD COLUMN IF NOT EXISTS approved_by integer;
ALTER TABLE staff_replacements ADD COLUMN IF NOT EXISTS approved_at timestamp;

-- staff_request_messages: поле text (фронт пишет text, в БД — message)
ALTER TABLE staff_request_messages ADD COLUMN IF NOT EXISTS text text;
UPDATE staff_request_messages SET text = message WHERE text IS NULL AND message IS NOT NULL;

-- employee_reviews: score + updated_at
ALTER TABLE employee_reviews ADD COLUMN IF NOT EXISTS score integer;
ALTER TABLE employee_reviews ADD COLUMN IF NOT EXISTS updated_at timestamp;
UPDATE employee_reviews SET score = rating WHERE score IS NULL AND rating IS NOT NULL;

-- customer_reviews: score + updated_at
ALTER TABLE customer_reviews ADD COLUMN IF NOT EXISTS score integer;
ALTER TABLE customer_reviews ADD COLUMN IF NOT EXISTS updated_at timestamp;
UPDATE customer_reviews SET score = rating WHERE score IS NULL AND rating IS NOT NULL;

-- work_expenses: ФОТ-поля + invoice + doc_number
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS invoice_needed boolean DEFAULT false;
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS invoice_received boolean DEFAULT false;
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS doc_number varchar(255);
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS fot_base_pay numeric(15,2);
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS fot_per_diem numeric(15,2);
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS fot_bonus numeric(15,2);
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS fot_date_from date;
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS fot_date_to date;
UPDATE work_expenses SET doc_number = document_number WHERE doc_number IS NULL AND document_number IS NOT NULL;
