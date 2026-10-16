-- ============================================================================
-- V398: Часть II — email-цепочка согласования счетов.
-- ----------------------------------------------------------------------------
-- Что закрывает (плана II.2, II.4.5, блокеры B2/B3, FAIL C6):
--   • payment_invoices: TTL 72ч (approval_expires_at), статусы expired/archived,
--     источник (email) и тред — для «одно Добро на письмо»;
--   • doc_email_intake: связь письмо+вложение → doc_registry + payment_invoices,
--     UNIQUE(email_id, attachment_id) — антидубль (F4);
--   • email_threads: тред-контекст согласования («Добро» → счета);
--   • настройки CRM-копии и порога уверенности парсинга.
-- Идемпотентно, аддитивно. Down — V398__..._down.sql.
-- ============================================================================

-- ── 1. payment_invoices: TTL, архив, источник из письма ─────────────────────
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS approval_expires_at TIMESTAMPTZ;
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS source_email_id INTEGER;
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS source_attachment_id INTEGER;
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS source_thread_key TEXT;
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS external_approver_email TEXT;
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS approval_channel VARCHAR(12);

-- Расширяем допустимые статусы (V349 задавал свой CHECK — аккуратно).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'payment_invoices_status_check') THEN
    ALTER TABLE payment_invoices DROP CONSTRAINT payment_invoices_status_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_pi_status_v398') THEN
    ALTER TABLE payment_invoices ADD CONSTRAINT chk_pi_status_v398
      CHECK (status IN ('awaiting_dir','pending_payment','paid','rejected','expired','archived'));
  END IF;
END $$;

-- Антидубль заявки по источнику (F4): одно вложение письма → одна заявка.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pi_source_attachment
  ON payment_invoices (source_email_id, source_attachment_id)
  WHERE source_email_id IS NOT NULL AND source_attachment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pi_awaiting_expires
  ON payment_invoices (approval_expires_at)
  WHERE status = 'awaiting_dir';

-- ── 2. doc_email_intake: оркестратор intake (email+attachment → doc) ────────
CREATE TABLE IF NOT EXISTS doc_email_intake (
  id                SERIAL PRIMARY KEY,
  email_id          INTEGER,
  attachment_id     INTEGER,
  thread_key        TEXT,
  doc_id            INTEGER,
  payment_invoice_id INTEGER,
  counterparty_inn  VARCHAR(20),
  invoice_number    TEXT,
  invoice_date      DATE,
  amount_gross      NUMERIC(14,2),
  currency          VARCHAR(8) DEFAULT 'RUB',
  parse_confidence  NUMERIC(4,3),
  parse_raw         JSONB DEFAULT '{}',
  status            VARCHAR(16) NOT NULL DEFAULT 'parsed',
  error             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_intake_status') THEN
    ALTER TABLE doc_email_intake ADD CONSTRAINT chk_intake_status
      CHECK (status IN ('parsed','needs_manual','linked','rejected','failed'));
  END IF;
END $$;

-- F4: антидубль по паре письмо+вложение.
CREATE UNIQUE INDEX IF NOT EXISTS uq_intake_email_attachment
  ON doc_email_intake (email_id, attachment_id)
  WHERE email_id IS NOT NULL AND attachment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_intake_doc ON doc_email_intake (doc_id);
CREATE INDEX IF NOT EXISTS idx_intake_thread ON doc_email_intake (thread_key);

-- ── 3. email_threads: тред-контекст согласования ────────────────────────────
CREATE TABLE IF NOT EXISTS email_threads (
  id                 SERIAL PRIMARY KEY,
  thread_key         TEXT NOT NULL UNIQUE,
  subject_norm       TEXT,
  initiator_email    TEXT,
  initiator_user_id  INTEGER,
  approver_user_id   INTEGER,
  state              VARCHAR(12) NOT NULL DEFAULT 'pending',
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_thread_state') THEN
    ALTER TABLE email_threads ADD CONSTRAINT chk_thread_state
      CHECK (state IN ('pending','approved','rejected','expired'));
  END IF;
END $$;

-- ── 4. Настройки Части II ───────────────────────────────────────────────────
INSERT INTO settings (key, value_json, updated_at) VALUES
  ('crm_cc_address',            '"crm@asgard-service.com"', NOW()),
  ('doc_approver_user_id',      '3456',  NOW()),
  ('email_intake_enabled',      'false', NOW()),
  ('email_parse_confidence_min','0.700', NOW()),
  ('doc_approval_ttl_hours',    '72',    NOW()),
  ('email_intake_mailbox_id',   '112',   NOW())
ON CONFLICT (key) DO NOTHING;

COMMENT ON COLUMN payment_invoices.approval_expires_at IS
  'V398: TTL согласования директора (по умолчанию +72ч из doc_approval_ttl_hours).';
COMMENT ON TABLE doc_email_intake IS
  'V398: intake-оркестратор — письмо+вложение → doc_registry/payment_invoices; UNIQUE(email_id,attachment_id).';
