-- V349: Универсальные счета на оплату (очередь #/approval-payment + email директору)
-- Не путать с procurement_requests: DIR/BUH работают с payment_invoices, не с модалкой заявки.

CREATE TABLE IF NOT EXISTS payment_invoices (
  id                SERIAL PRIMARY KEY,
  status            VARCHAR(32) NOT NULL DEFAULT 'awaiting_dir',
  -- awaiting_dir | dir_approved | pending_payment | paid | rejected | rework | question
  supplier_name     TEXT,
  supplier_id       INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  amount            NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency          VARCHAR(8) NOT NULL DEFAULT 'RUB',
  due_date          DATE,
  file_path         TEXT,
  file_name         TEXT,
  invoice_doc_id    INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  basis_type        VARCHAR(32),  -- work | contract | to | other
  basis_text        TEXT,
  work_id           INTEGER REFERENCES works(id) ON DELETE SET NULL,
  contract_id       INTEGER,
  procurement_id    INTEGER REFERENCES procurement_requests(id) ON DELETE SET NULL,
  invoice_import_id INTEGER REFERENCES procurement_invoice_imports(id) ON DELETE SET NULL,
  line_items_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- V046-совместимые поля оплаты
  requires_payment  BOOLEAN NOT NULL DEFAULT true,
  payment_method    VARCHAR(20),
  payment_status    VARCHAR(30),
  payment_comment   TEXT,
  payment_doc_id    INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  buh_id            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  buh_acted_at      TIMESTAMPTZ,
  dir_approved_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  dir_approved_at   TIMESTAMPTZ,
  dir_comment       TEXT,
  created_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_invoices_status ON payment_invoices(status);
CREATE INDEX IF NOT EXISTS idx_payment_invoices_pay ON payment_invoices(requires_payment, payment_status);
CREATE INDEX IF NOT EXISTS idx_payment_invoices_proc ON payment_invoices(procurement_id);
CREATE INDEX IF NOT EXISTS idx_payment_invoices_import ON payment_invoices(invoice_import_id);

-- Токены email-согласования (паттерн cash_mail_tokens)
CREATE TABLE IF NOT EXISTS payment_mail_tokens (
  id              SERIAL PRIMARY KEY,
  payment_id      INTEGER NOT NULL REFERENCES payment_invoices(id) ON DELETE CASCADE,
  token_hash      CHAR(64) NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  used_action     VARCHAR(16),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_mail_tokens_pay ON payment_mail_tokens(payment_id);

COMMENT ON TABLE payment_invoices IS 'Счета на оплату: standalone ТО или волна из закупки; DIR/BUH через очередь оплаты';
