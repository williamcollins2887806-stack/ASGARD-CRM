-- ═══════════════════════════════════════════════════════════════════════════
-- V243: Stage W — Cash redesign + handovers + paid_by_role
-- ═══════════════════════════════════════════════════════════════════════════
-- 1. cash_requests:
--    - убираем тип 'loan' (UI и API больше не позволяют) — backfill loan→advance
--    - добавляем category (12 категорий + 'other' с обязательным description)
--    - добавляем use_se_payee/se_payee_employee_id/se_transfer_id для аванса
--      РП через СЗ-перевод (вместо нала)
--
-- 2. worker_to_pm_handovers (НОВАЯ):
--    Бух перевёл рабочему-СЗ деньги для РП → рабочий должен передать нал РП.
--    Каждая запись — задача «передать N руб от рабочего РП за месяц».
--    Источник expected_amount — se_transfers(operation_type='agreement_transfer'
--    или transfer_amount по работе) со status='transferred'.
--
-- 3. worker_payments:
--    - payment_method NOT NULL + DEFAULT 'cash' (закрываем NULL-кейс legacy)
--    - paid_by_role ('pm'/'director'/'buh'/'admin'/'field_master') — какая роль
--      реально выплатила в поле (нужно для отчётов и /director-payments)
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. cash_requests: убрать loan, добавить категории + СЗ-опцию
-- ───────────────────────────────────────────────────────────────────────────

-- если CHECK type был — снимаем (loan-варианты тоже могут быть в enum)
ALTER TABLE cash_requests DROP CONSTRAINT IF EXISTS chk_cash_request_type;
ALTER TABLE cash_requests DROP CONSTRAINT IF EXISTS cash_requests_type_check;

ALTER TABLE cash_requests
  ADD COLUMN IF NOT EXISTS category VARCHAR(40),
  ADD COLUMN IF NOT EXISTS category_other_desc TEXT,
  ADD COLUMN IF NOT EXISTS use_se_payee BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS se_payee_employee_id INT REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS se_transfer_id INT REFERENCES se_transfers(id);

-- Backfill: исторические loan-заявки переходят в advance.
UPDATE cash_requests SET type = 'advance' WHERE type = 'loan';

-- CHECK type — закрытый набор. Idempotent: создаём только если нет.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cash_request_type_v243'
  ) THEN
    ALTER TABLE cash_requests ADD CONSTRAINT chk_cash_request_type_v243
      CHECK (type IN ('advance', 'office', 'other'));
  END IF;
END $$;

-- CHECK category — закрытый набор из 12 (либо NULL для legacy-записей).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cash_request_category_v243'
  ) THEN
    ALTER TABLE cash_requests ADD CONSTRAINT chk_cash_request_category_v243
      CHECK (category IS NULL OR category IN (
        'fuel_service', 'fuel_personal', 'taxi', 'accommodation',
        'food_brigade', 'materials', 'tool', 'tech_rent',
        'communication', 'representational', 'urgent_repair', 'other'
      ));
  END IF;
END $$;

-- Если use_se_payee=true → se_payee_employee_id ОБЯЗАТЕЛЕН.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_cash_request_se_payee_v243'
  ) THEN
    ALTER TABLE cash_requests ADD CONSTRAINT chk_cash_request_se_payee_v243
      CHECK (use_se_payee = false OR se_payee_employee_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cash_requests_category
  ON cash_requests(category) WHERE category IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cash_requests_se_payee
  ON cash_requests(se_payee_employee_id) WHERE se_payee_employee_id IS NOT NULL;

COMMENT ON COLUMN cash_requests.category IS 'Одна из 12 категорий авансового отчёта (см. STAGE_W_CONTRACT.md)';
COMMENT ON COLUMN cash_requests.category_other_desc IS 'Обязательно если category=other';
COMMENT ON COLUMN cash_requests.use_se_payee IS 'true = выдать через СЗ-перевод (бух создаст se_transfers агр-перевод)';
COMMENT ON COLUMN cash_requests.se_payee_employee_id IS 'Получатель СЗ-перевода (родственник РП или сам РП-СЗ)';
COMMENT ON COLUMN cash_requests.se_transfer_id IS 'FK на se_transfers, если выдача прошла через СЗ-перевод';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. worker_to_pm_handovers — новая таблица
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS worker_to_pm_handovers (
  id SERIAL PRIMARY KEY,
  worker_id INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  pm_user_id INT NOT NULL REFERENCES users(id),
  work_id INT REFERENCES works(id) ON DELETE SET NULL,
  year INT NOT NULL CHECK (year >= 2020 AND year <= 2099),
  month INT NOT NULL CHECK (month BETWEEN 1 AND 12),
  source_se_transfer_id INT REFERENCES se_transfers(id) ON DELETE SET NULL,
  source_worker_payment_id INT REFERENCES worker_payments(id) ON DELETE SET NULL,
  expected_amount NUMERIC(12,2) NOT NULL CHECK (expected_amount >= 0),
  received_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (received_amount >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','received','partial','not_received','cancelled')),
  received_at TIMESTAMPTZ,
  received_by INT REFERENCES users(id),
  note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Уникальность по source_se_transfer_id — одна запись на 1 СЗ-перевод
-- (PARTIAL: не блокируем строки без source_se_transfer_id, например ручные).
CREATE UNIQUE INDEX IF NOT EXISTS uq_handover_source
  ON worker_to_pm_handovers(source_se_transfer_id)
  WHERE source_se_transfer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_handovers_pm_period
  ON worker_to_pm_handovers(pm_user_id, year, month);
CREATE INDEX IF NOT EXISTS idx_handovers_worker_period
  ON worker_to_pm_handovers(worker_id, year, month);
CREATE INDEX IF NOT EXISTS idx_handovers_status
  ON worker_to_pm_handovers(status) WHERE status = 'pending';

COMMENT ON TABLE worker_to_pm_handovers IS
  'Stage W: «передача от рабочего к РП» — после того как бух перевёл рабочему-СЗ деньги, рабочий передаёт нал РП. РП подтверждает.';
COMMENT ON COLUMN worker_to_pm_handovers.expected_amount IS 'Сколько должен передать (= transfer_amount из se_transfers).';
COMMENT ON COLUMN worker_to_pm_handovers.received_amount IS 'Сколько РП реально получил (0 если not_received, частично или полная сумма).';
COMMENT ON COLUMN worker_to_pm_handovers.status IS 'pending(жду) / received(получил полностью) / partial(частично) / not_received(не получил) / cancelled.';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. worker_payments: payment_method NOT NULL + paid_by_role
-- ───────────────────────────────────────────────────────────────────────────

-- Backfill NULL → 'cash' (legacy записи где payment_method не выставили)
UPDATE worker_payments SET payment_method = 'cash' WHERE payment_method IS NULL;

-- Защита от регресса: дефолт + NOT NULL
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'worker_payments' AND column_name = 'payment_method'
      AND is_nullable = 'YES'
  ) THEN
    ALTER TABLE worker_payments ALTER COLUMN payment_method SET DEFAULT 'cash';
    ALTER TABLE worker_payments ALTER COLUMN payment_method SET NOT NULL;
  END IF;
END $$;

ALTER TABLE worker_payments
  ADD COLUMN IF NOT EXISTS paid_by_role VARCHAR(20);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_wp_paid_by_role_v243'
  ) THEN
    ALTER TABLE worker_payments ADD CONSTRAINT chk_wp_paid_by_role_v243
      CHECK (paid_by_role IS NULL
             OR paid_by_role IN ('pm', 'director', 'buh', 'admin', 'field_master'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wp_paid_by_role
  ON worker_payments(paid_by_role) WHERE paid_by_role IS NOT NULL;

COMMENT ON COLUMN worker_payments.paid_by_role IS
  'Stage W: какая роль реально провела выплату в поле. Нужно для /director-payments истории и отчёта «сколько выплатил директор vs РП».';

COMMIT;
