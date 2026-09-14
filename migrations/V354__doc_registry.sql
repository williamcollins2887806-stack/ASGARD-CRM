-- V354: Doc Hub — единый реестр счетов / СФ / УПД (doc_registry)
-- Не путать с payment_invoices (очередь DIR/BUH на оплату).

CREATE TABLE IF NOT EXISTS doc_registry (
  id                    SERIAL PRIMARY KEY,
  dir                   VARCHAR(8) NOT NULL CHECK (dir IN ('in', 'out')),
  package_type          VARCHAR(32) NOT NULL DEFAULT 'invoice',
  -- invoice | sf | upd | invoice_sf | other
  ops_status            VARCHAR(32) NOT NULL DEFAULT 'draft',
  -- draft | wait_pay | paid | wait_sf | wait_closing | wh_transfer | incomplete | out_sent | done | cancelled

  invoice_number        TEXT,
  invoice_date          DATE,
  counterparty_name     TEXT NOT NULL DEFAULT '',
  counterparty_email    TEXT,
  counterparty_phone    TEXT,
  supplier_id           INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  customer_id           INTEGER,

  work_id               INTEGER REFERENCES works(id) ON DELETE SET NULL,
  contract_id           INTEGER,
  contract_mode         VARCHAR(16) NOT NULL DEFAULT 'none'
                        CHECK (contract_mode IN ('linked','created','once','general','none')),
  contract_label        TEXT,

  amount_gross          NUMERIC(14,2) NOT NULL DEFAULT 0,
  amount_net            NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  vat_rate              NUMERIC(6,4) NOT NULL DEFAULT 0.22,
  has_vat               BOOLEAN NOT NULL DEFAULT true,

  payment_due_at        DATE,
  sf_due_at             DATE,
  delivery_due_at       DATE,
  delivery_note         TEXT,
  pay_status            VARCHAR(24) NOT NULL DEFAULT 'none',
  -- none | wait | paid | overdue | n_a

  closing_json          JSONB NOT NULL DEFAULT '[]'::jsonb,
  receive_channel       VARCHAR(64),
  reconciliation_note   TEXT,
  purpose_customer      BOOLEAN NOT NULL DEFAULT false,
  purpose_asgard        BOOLEAN NOT NULL DEFAULT false,
  purpose_consumables   BOOLEAN NOT NULL DEFAULT false,
  comment_text          TEXT,

  wh_status             VARCHAR(16) NOT NULL DEFAULT 'none'
                        CHECK (wh_status IN ('none','await','received','to_office','buh_ok')),

  procurement_id        INTEGER REFERENCES procurement_requests(id) ON DELETE SET NULL,
  payment_invoice_id    INTEGER REFERENCES payment_invoices(id) ON DELETE SET NULL,
  office_expense_id     INTEGER,
  work_expense_id       INTEGER,
  billing_invoice_id    INTEGER,
  billing_act_id        INTEGER,

  attachments           JSONB NOT NULL DEFAULT '[]'::jsonb,
  original_path_url     TEXT,
  parsed_json           JSONB NOT NULL DEFAULT '[]'::jsonb,

  is_incomplete         BOOLEAN NOT NULL DEFAULT false,
  incomplete_reasons    TEXT[] NOT NULL DEFAULT '{}',

  onec_id               TEXT,
  onec_synced_at        TIMESTAMPTZ,
  onec_payload          JSONB,
  edo_status            VARCHAR(32),
  edo_external_id       TEXT,

  doc_owner_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pm_id                 INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

-- Антидубль: контрагент + номер счёта + дата + сумма + направление
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_registry_dedup
  ON doc_registry (
    lower(trim(counterparty_name)),
    lower(trim(COALESCE(invoice_number, ''))),
    invoice_date,
    amount_gross,
    dir
  )
  WHERE deleted_at IS NULL AND invoice_number IS NOT NULL AND invoice_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_doc_registry_dir ON doc_registry(dir) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_registry_ops ON doc_registry(ops_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_registry_owner ON doc_registry(doc_owner_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_registry_pm ON doc_registry(pm_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_registry_work ON doc_registry(work_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_registry_pay_due ON doc_registry(payment_due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_registry_sf_due ON doc_registry(sf_due_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_registry_wh ON doc_registry(wh_status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_registry_proc ON doc_registry(procurement_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_registry_pay_inv ON doc_registry(payment_invoice_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_registry_onec ON doc_registry(onec_id) WHERE deleted_at IS NULL AND onec_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_doc_registry_incomplete ON doc_registry(is_incomplete) WHERE deleted_at IS NULL AND is_incomplete;

CREATE TABLE IF NOT EXISTS doc_registry_audit (
  id          BIGSERIAL PRIMARY KEY,
  doc_id      INTEGER NOT NULL REFERENCES doc_registry(id) ON DELETE CASCADE,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(64) NOT NULL,
  payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_doc_registry_audit_doc ON doc_registry_audit(doc_id);

COMMENT ON TABLE doc_registry IS 'Doc Hub: реестр входящих/исходящих счетов, СФ, УПД';
