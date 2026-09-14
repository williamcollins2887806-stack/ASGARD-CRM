-- V351: batch-токены для группового письма директору (несколько счетов = одно решение)
CREATE TABLE IF NOT EXISTS payment_mail_batches (
  id              SERIAL PRIMARY KEY,
  token_hash      CHAR(64) NOT NULL UNIQUE,
  payment_ids     INTEGER[] NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  used_action     VARCHAR(16),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_mail_batches_ids ON payment_mail_batches USING GIN (payment_ids);

COMMENT ON TABLE payment_mail_batches IS 'Одно письмо директору на группу payment_invoices; Согласовать все / Отказать все';
