-- V386: payout_confirmation_codes — одноразовые коды подтверждения выплаты.
-- ═══════════════════════════════════════════════════════════════════════════
-- По образцу huginn_login_codes (V371): код хранится хешем (bcrypt), TTL,
-- лимит попыток. Используется для подтверждения рабочим получения выплаты
-- через SMS (Mango) или MAX.
--
-- channel: sms | max
-- Привязка: payment_id + employee_id (кого именно спрашиваем).

CREATE TABLE IF NOT EXISTS payout_confirmation_codes (
  id          BIGSERIAL PRIMARY KEY,
  payment_id  INTEGER      NOT NULL REFERENCES worker_payments(id) ON DELETE CASCADE,
  employee_id INTEGER      NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  phone       VARCHAR(32),
  channel     VARCHAR(10)  NOT NULL DEFAULT 'sms',
  code_hash   TEXT         NOT NULL,
  attempts    INTEGER      NOT NULL DEFAULT 0,
  used        BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ  NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_pcc_channel'
  ) THEN
    ALTER TABLE payout_confirmation_codes
      ADD CONSTRAINT chk_pcc_channel CHECK (channel IN ('sms','max'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_pcc_payment
  ON payout_confirmation_codes (payment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pcc_employee_active
  ON payout_confirmation_codes (employee_id, expires_at DESC)
  WHERE used = false;

COMMENT ON TABLE payout_confirmation_codes IS
  'V386: одноразовые коды подтверждения получения выплаты (SMS/MAX), по образцу huginn_login_codes.';
