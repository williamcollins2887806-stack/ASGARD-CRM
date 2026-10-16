-- ============================================================================
-- V394: Doc Hub — светофор, корректировки, акты сверки, крон-дайджест,
--       оплата/СФ-трекинг, производственный календарь.
-- ----------------------------------------------------------------------------
-- Идемпотентно (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS),
-- аддитивно: без DROP существующих данных. Down — V394__..._down.sql.
-- Заказчик: 12-16.10.2026 (светофор, корректировки, акты сверки, дайджест).
-- Связано: D-238 (разворачиваем «no_payment_due»), FEATURE_DOC_TRAFFIC_LIGHT.
-- ============================================================================

-- ── 1. doc_registry: поля оплаты / СФ / корректировки / актов ───────────────
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS payment_kind   VARCHAR(12);
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS payment_schedule JSONB DEFAULT '[]';
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS sf_basis        VARCHAR(12);
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS service_done_at DATE;
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS no_payment_terms BOOLEAN DEFAULT false;

-- Корректировка (СФ/акт признан неверным бухгалтерией).
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS correction_state   VARCHAR(12) DEFAULT 'none';
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS correction_kind    VARCHAR(8);
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS correction_comment TEXT;
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS correction_by      INTEGER;
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS correction_at      TIMESTAMPTZ;

-- Явный трекинг СФ (сейчас был только в closing_json).
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS sf_requested_at DATE;
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS sf_received_at  DATE;

-- Акты сверки по строке (дедлайн/запрос/получение).
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS recon_requested_at DATE;
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS recon_received_at  DATE;
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS recon_due_at       DATE;
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS currency VARCHAR(8) DEFAULT 'RUB';
ALTER TABLE doc_registry ADD COLUMN IF NOT EXISTS amount_currency NUMERIC(14,2);

-- Конверты (CHECK добавляются отдельно — безопасно для существующих строк).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_doc_payment_kind') THEN
    ALTER TABLE doc_registry ADD CONSTRAINT chk_doc_payment_kind
      CHECK (payment_kind IS NULL OR payment_kind IN ('prepay','postpay','partial'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_doc_sf_basis') THEN
    ALTER TABLE doc_registry ADD CONSTRAINT chk_doc_sf_basis
      CHECK (sf_basis IS NULL OR sf_basis IN ('invoice','service'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_doc_correction_state') THEN
    ALTER TABLE doc_registry ADD CONSTRAINT chk_doc_correction_state
      CHECK (correction_state IS NULL OR correction_state IN ('none','requested','resolved'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_doc_correction_kind') THEN
    ALTER TABLE doc_registry ADD CONSTRAINT chk_doc_correction_kind
      CHECK (correction_kind IS NULL OR correction_kind IN ('sf','act','both'));
  END IF;
END $$;

-- ── 2. doc_reconciliation_acts: акты сверки по контрагенту/периоду ──────────
CREATE TABLE IF NOT EXISTS doc_reconciliation_acts (
  id                SERIAL PRIMARY KEY,
  counterparty_inn  VARCHAR(20),
  counterparty_name TEXT,
  supplier_id       INTEGER,
  period_year       INTEGER NOT NULL,
  period_quarter    INTEGER NOT NULL DEFAULT 0,   -- 0 = годовой
  due_at            DATE,
  requested_at      DATE,
  requested_by      INTEGER,
  received_at       TIMESTAMPTZ,
  received_by       INTEGER,
  status            VARCHAR(12) NOT NULL DEFAULT 'planned',
  file_url          TEXT,
  file_meta         JSONB DEFAULT '{}',
  manual_adjustments JSONB DEFAULT '[]',
  balance_rub       NUMERIC(16,2),
  balance_currency  NUMERIC(16,2),
  currency          VARCHAR(8) DEFAULT 'RUB',
  comment           TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recon_status') THEN
    ALTER TABLE doc_reconciliation_acts ADD CONSTRAINT chk_recon_status
      CHECK (status IN ('planned','requested','received','overdue'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_recon_quarter') THEN
    ALTER TABLE doc_reconciliation_acts ADD CONSTRAINT chk_recon_quarter
      CHECK (period_quarter BETWEEN 0 AND 4);
  END IF;
END $$;

-- Уникальность: по ИНН, при отсутствии — по нормализованному имени.
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_inn_period
  ON doc_reconciliation_acts (counterparty_inn, period_year, period_quarter)
  WHERE counterparty_inn IS NOT NULL AND counterparty_inn <> '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_recon_name_period
  ON doc_reconciliation_acts (lower(trim(counterparty_name)), period_year, period_quarter)
  WHERE (counterparty_inn IS NULL OR counterparty_inn = '') AND counterparty_name IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recon_due   ON doc_reconciliation_acts (due_at) WHERE status <> 'received';
CREATE INDEX IF NOT EXISTS idx_recon_inn   ON doc_reconciliation_acts (counterparty_inn);
CREATE INDEX IF NOT EXISTS idx_recon_supp  ON doc_reconciliation_acts (supplier_id);

-- ── 3. doc_reminder_log: антидубль и ретраи крон-дайджеста ──────────────────
CREATE TABLE IF NOT EXISTS doc_reminder_log (
  id        SERIAL PRIMARY KEY,
  doc_id    INTEGER,
  user_id   INTEGER,
  kind      VARCHAR(20) NOT NULL,
  due_date  DATE,
  sent_at   TIMESTAMPTZ DEFAULT NOW(),
  error     TEXT,
  attempts  INTEGER DEFAULT 0,
  UNIQUE (doc_id, user_id, kind, due_date)
);

CREATE INDEX IF NOT EXISTS idx_reminder_log_kind ON doc_reminder_log (kind, due_date);

-- ── 4. work_calendar: производственный календарь (переносы/праздники) ───────
CREATE TABLE IF NOT EXISTS work_calendar (
  date       DATE PRIMARY KEY,
  is_working BOOLEAN NOT NULL DEFAULT true,
  note       TEXT
);

-- Сид: праздничные и перенесённые нерабочие дни РФ 2026-2027.
-- Суббота/воскресенье вычисляются в коде, если записи нет.
INSERT INTO work_calendar (date, is_working, note) VALUES
  -- 2026
  ('2026-01-01', false, 'Новогодние каникулы'),
  ('2026-01-02', false, 'Новогодние каникулы'),
  ('2026-01-05', false, 'Новогодние каникулы'),
  ('2026-01-06', false, 'Новогодние каникулы'),
  ('2026-01-07', false, 'Рождество Христово'),
  ('2026-01-08', false, 'Новогодние каникулы'),
  ('2026-01-09', false, 'Новогодние каникулы'),
  ('2026-02-23', false, 'День защитника Отечества'),
  ('2026-03-09', false, 'Международный женский день (перенос с 08.03)'),
  ('2026-05-01', false, 'Праздник Весны и Труда'),
  ('2026-05-11', false, 'День Победы (перенос с 09.05)'),
  ('2026-06-12', false, 'День России'),
  ('2026-11-04', false, 'День народного единства'),
  -- 2027
  ('2027-01-01', false, 'Новогодние каникулы'),
  ('2027-01-04', false, 'Новогодние каникулы'),
  ('2027-01-05', false, 'Новогодние каникулы'),
  ('2027-01-06', false, 'Новогодние каникулы'),
  ('2027-01-07', false, 'Рождество Христово'),
  ('2027-01-08', false, 'Новогодние каникулы'),
  ('2027-02-23', false, 'День защитника Отечества'),
  ('2027-03-08', false, 'Международный женский день'),
  ('2027-05-03', false, 'Праздник Весны и Труда (перенос с 01.05)'),
  ('2027-05-10', false, 'День Победы (перенос с 09.05)'),
  ('2027-06-14', false, 'День России (перенос с 12.06)'),
  ('2027-11-04', false, 'День народного единства')
ON CONFLICT (date) DO NOTHING;

-- ── 5. Настройки (значения — строковый JSON, как принято в settings) ────────
INSERT INTO settings (key, value_json, updated_at) VALUES
  ('doc_sf_due_days',              '5',        NOW()),
  ('doc_yellow_workdays',          '5',        NOW()),
  ('doc_recon_quarter_deadline_day', '10',     NOW()),
  ('doc_recon_year_deadline',      '"01-15"',  NOW()),
  ('doc_digest_cron_time',         '"08:30"',  NOW()),
  ('doc_digest_enabled',           'true',     NOW()),
  ('feature_doc_traffic_light',    'false',    NOW()),
  ('doc_currency_rates',           '{}',       NOW())
ON CONFLICT (key) DO NOTHING;

-- ── 6. Индексы под светофор (частичные — только «горячие» строки) ───────────
CREATE INDEX IF NOT EXISTS idx_doc_payment_due_open
  ON doc_registry (payment_due_at)
  WHERE deleted_at IS NULL AND payment_due_at IS NOT NULL AND pay_status <> 'paid';
CREATE INDEX IF NOT EXISTS idx_doc_sf_due_open
  ON doc_registry (sf_due_at)
  WHERE deleted_at IS NULL AND sf_due_at IS NOT NULL AND sf_received_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_correction_open
  ON doc_registry (correction_state)
  WHERE deleted_at IS NULL AND correction_state = 'requested';
CREATE INDEX IF NOT EXISTS idx_doc_recon_due_open
  ON doc_registry (recon_due_at)
  WHERE deleted_at IS NULL AND recon_due_at IS NOT NULL AND recon_received_at IS NULL;

-- ── 7. Backfill: не «красним» старые строки из-за новых обязательных полей ──
-- Существующие строки получают postpay и «условия не заданы» не выставляем,
-- чтобы светофор не поднял массово синий на всём архиве.
UPDATE doc_registry SET payment_kind = 'postpay'
 WHERE payment_kind IS NULL AND deleted_at IS NULL;

-- sf_received_at из closing_json (если там есть дата СФ).
UPDATE doc_registry SET sf_received_at = sub.d
  FROM (
    SELECT d2.id,
           MAX(NULLIF(TRIM(elem->>'date'), ''))::date AS d
      FROM doc_registry d2
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(d2.closing_json) = 'array' THEN d2.closing_json ELSE '[]'::jsonb END
      ) elem
     WHERE d2.deleted_at IS NULL AND elem->>'date' ~ '^\d{4}-\d{2}-\d{2}'
     GROUP BY d2.id
  ) sub
 WHERE doc_registry.id = sub.id AND doc_registry.sf_received_at IS NULL;
