-- V391: Планы выплат — список согласования, второй получатель, «через кого»,
--        корректировка остатка, план ОВ на 1-е число.
-- ═══════════════════════════════════════════════════════════════════════════
-- Зачем: контур выплат получает согласование директором. Раньше /pay сразу
-- писал worker_payments.status='paid' — согласования не было вообще.
--
-- Что добавляется:
--   employees.se_payee_id_2            — второй получатель НПД (до 2)
--   worker_payments.payee_employee_id  — через кого ФАКТИЧЕСКИ перевели
--   worker_payments.type += 'carry_adjustment' — корректировка остатка (+/−)
--   payout_batches / payout_batch_items — список: черновик → согласование → выплата
--   payout_plans / payout_plan_items    — план ОВ на месяц (1-е число)
--
-- Идемпотентно: ADD COLUMN IF NOT EXISTS, CREATE TABLE IF NOT EXISTS,
-- ограничения через DO-блоки. Существующие данные не трогаются.

-- ── 1. Второй получатель у сотрудника ─────────────────────────────────────
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS se_payee_id_2 INTEGER REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_se_payee2
  ON employees(se_payee_id_2) WHERE se_payee_id_2 IS NOT NULL;

COMMENT ON COLUMN employees.se_payee_id_2 IS
  'V391: второй родственник-получатель НПД-выплат (до 2 получателей на рабочего).';

-- ── 2. Через кого перевели (в факте выплаты) ──────────────────────────────
ALTER TABLE worker_payments
  ADD COLUMN IF NOT EXISTS payee_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_wp_payee_employee
  ON worker_payments(payee_employee_id) WHERE payee_employee_id IS NOT NULL;

COMMENT ON COLUMN worker_payments.payee_employee_id IS
  'V391: получатель, через которого реально ушла выплата (для истории/архива/ведомости).';

-- ── 3. Тип «Корректировка остатка» ────────────────────────────────────────
-- Знак хранится в amount (минус = списание долга компании рабочему).
-- Причина обязательна — контроль на уровне API (comment NOT NULL не ставим,
-- чтобы не сломать существующие записи).
DO $$
BEGIN
  ALTER TABLE worker_payments DROP CONSTRAINT IF EXISTS worker_payments_type_check;
  ALTER TABLE worker_payments
    ADD CONSTRAINT worker_payments_type_check
    CHECK (type::text = ANY (ARRAY[
      'per_diem'::text, 'salary'::text, 'advance'::text, 'bonus'::text,
      'penalty'::text, 'carry_adjustment'::text
    ]));
END $$;

-- ── 4. Список согласования ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payout_batches (
  id                SERIAL PRIMARY KEY,
  batch_uuid        UUID NOT NULL DEFAULT gen_random_uuid(),
  period_year       INTEGER NOT NULL,
  period_month      INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status            VARCHAR(24) NOT NULL DEFAULT 'draft',
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  submitted_at      TIMESTAMPTZ,
  decided_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  decided_at        TIMESTAMPTZ,
  decision_comment  TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pb_status CHECK (status IN (
    'draft', 'pending_approval', 'partially_approved', 'approved', 'rejected', 'paid', 'cancelled'
  ))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pb_uuid ON payout_batches(batch_uuid);
CREATE INDEX IF NOT EXISTS idx_pb_period ON payout_batches(period_year, period_month, status);

CREATE TABLE IF NOT EXISTS payout_batch_items (
  id                 SERIAL PRIMARY KEY,
  batch_id           INTEGER NOT NULL REFERENCES payout_batches(id) ON DELETE CASCADE,
  employee_id        INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  kind               VARCHAR(12) NOT NULL DEFAULT 'salary',
  pay_amount         NUMERIC(14,2) NOT NULL CHECK (pay_amount >= 0),
  transfer_amount    NUMERIC(14,2),
  info_amount        NUMERIC(14,2),
  tax_amount         NUMERIC(14,2) DEFAULT 0,
  official_transfer  BOOLEAN NOT NULL DEFAULT FALSE,
  payout_platform    VARCHAR(40),
  payee_employee_id  INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  comment            TEXT,
  approval_status    VARCHAR(16) NOT NULL DEFAULT 'pending',
  reject_reason      TEXT,
  approved_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at        TIMESTAMPTZ,
  reapproved         BOOLEAN NOT NULL DEFAULT FALSE,
  worker_payment_id  INTEGER REFERENCES worker_payments(id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pbi_kind CHECK (kind IN ('advance', 'salary')),
  CONSTRAINT chk_pbi_approval CHECK (approval_status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT uq_pbi_batch_emp UNIQUE (batch_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_pbi_batch ON payout_batch_items(batch_id);
CREATE INDEX IF NOT EXISTS idx_pbi_emp ON payout_batch_items(employee_id, approval_status);

-- ── 5. План ОВ на месяц (1-е число) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS payout_plans (
  id             SERIAL PRIMARY KEY,
  period_year    INTEGER NOT NULL,
  period_month   INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status         VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  approved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_pp_status CHECK (status IN ('draft', 'approved', 'partially_approved'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pp_period
  ON payout_plans(period_year, period_month);

CREATE TABLE IF NOT EXISTS payout_plan_items (
  id                SERIAL PRIMARY KEY,
  plan_id           INTEGER NOT NULL REFERENCES payout_plans(id) ON DELETE CASCADE,
  employee_id       INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  to_transfer       NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (to_transfer >= 0),
  max_amount        NUMERIC(14,2),
  pay_date          DATE,
  payee_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
  approved          BOOLEAN NOT NULL DEFAULT FALSE,
  comment           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ppi_plan_emp UNIQUE (plan_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_ppi_plan ON payout_plan_items(plan_id);

-- ── 6. Настройки контура (вынос захардкоженных значений) ──────────────────
INSERT INTO settings (key, value_json, updated_at) VALUES
  ('payout_confirm_ttl_hours', '72', NOW()),
  ('payout_reminder_hours',    '24', NOW())
ON CONFLICT (key) DO NOTHING;

-- ── 7. Настройки плана выплат и графика (V391) ────────────────────────────
-- ВАЖНО: коэффициенты уже живут под своими ключами (payout_se_*), их не
-- дублируем. Здесь только то, чего ещё нет.
INSERT INTO settings (key, value_json, updated_at) VALUES
  ('payout_plan_first_day',      '1',  NOW()),  -- «не раньше 1-го числа»
  ('payout_transfer_lead_days',  '3',  NOW())   -- за сколько дней до даты переводим
ON CONFLICT (key) DO NOTHING;
-- Существующие ключи (проверено в src/lib/payout-calc.js):
--   payout_se_info_coef, payout_se_transfer_coef, payout_se_commission_rate,
--   payout_se_vat_rate, payout_official_markup_rate — НЕ трогаем.

-- ── 8. Доступ Димы Путкова в «дружину» ────────────────────────────────────
-- Роль BUH не входит в список допуска страницы #/personnel, поэтому выдаём
-- персональный грант (как settings.payout_manager_user_ids для выплат).
INSERT INTO settings (key, value_json, updated_at)
VALUES (
  'personnel_viewer_user_ids',
  COALESCE(
    (SELECT json_agg(u.id ORDER BY u.id)::text
       FROM users u
      WHERE u.is_active IS DISTINCT FROM false
        AND (u.login = 'd.putkov' OR u.id = 3465)),
    '[3465]'
  ),
  NOW()
)
ON CONFLICT (key) DO NOTHING;
