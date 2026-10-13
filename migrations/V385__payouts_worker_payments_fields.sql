-- V385: Страница выплат — расширение worker_payments под новый флоу.
-- ═══════════════════════════════════════════════════════════════════════════
-- Добавляет к факту выплаты то, чего не было:
--   payout_platform        — площадка/канал перевода (restaff/card/bank/cash/other)
--   payout_recipient_note  — кому идти за деньгами (ФИО кассира / РП)
--   transfer_amount        — сколько реально переведено (для СЗ: выплата + налог)
--   tax_amount             — налог СЗ (6% сверху), 0 для не-СЗ
--   confirmation_status    — awaiting | confirmed | disputed (маркер для Димы)
--   confirmation_deadline  — дедлайн подтверждения (72ч от paid_at)
--   reminder_sent_at       — когда отправлено напоминание
--   dispute_reason         — текст «не согласен/не получил»
--   dispute_at             — когда нажали спор
--   payout_batch_id        — UUID для идемпотентности/трассировки
--
-- Идемпотентно: ADD COLUMN IF NOT EXISTS, constraint через DO-блок.
-- Факты существующих выплат не трогаются (все новые колонки nullable/с дефолтом).

ALTER TABLE worker_payments
  ADD COLUMN IF NOT EXISTS payout_platform       VARCHAR(40),
  ADD COLUMN IF NOT EXISTS payout_recipient_note TEXT,
  ADD COLUMN IF NOT EXISTS transfer_amount       NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tax_amount            NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS confirmation_status   VARCHAR(20),
  ADD COLUMN IF NOT EXISTS confirmation_deadline TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_sent_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dispute_reason        TEXT,
  ADD COLUMN IF NOT EXISTS dispute_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS payout_batch_id       UUID;

-- CHECK на confirmation_status (идемпотентно через DO)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_wp_confirmation_status'
  ) THEN
    ALTER TABLE worker_payments
      ADD CONSTRAINT chk_wp_confirmation_status
      CHECK (confirmation_status IS NULL OR confirmation_status IN ('awaiting','confirmed','disputed'));
  END IF;
END $$;

-- CHECK на payout_platform (свободный список площадок, но с ядром)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_wp_payout_platform'
  ) THEN
    ALTER TABLE worker_payments
      ADD CONSTRAINT chk_wp_payout_platform
      CHECK (payout_platform IS NULL OR payout_platform IN ('restaff','card','bank','cash','other'));
  END IF;
END $$;

-- Индексы под выборку списка выплат и под очередь подтверждений
CREATE INDEX IF NOT EXISTS idx_wp_payout_period_status
  ON worker_payments (pay_year, pay_month, status);

CREATE INDEX IF NOT EXISTS idx_wp_confirmation_pending
  ON worker_payments (confirmation_status, confirmation_deadline)
  WHERE confirmation_status IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_wp_payout_batch
  ON worker_payments (payout_batch_id)
  WHERE payout_batch_id IS NOT NULL;

COMMENT ON COLUMN worker_payments.payout_platform IS
  'V385: площадка/канал перевода (restaff/card/bank/cash/other).';
COMMENT ON COLUMN worker_payments.payout_recipient_note IS
  'V385: кому идти за деньгами (ФИО кассира / РП).';
COMMENT ON COLUMN worker_payments.transfer_amount IS
  'V385: фактически переведённая сумма (СЗ: выплата + налог).';
COMMENT ON COLUMN worker_payments.tax_amount IS
  'V385: налог СЗ (6% сверху), 0 для не-СЗ.';
COMMENT ON COLUMN worker_payments.confirmation_status IS
  'V385: awaiting|confirmed|disputed — маркер подтверждения получения рабочим.';
COMMENT ON COLUMN worker_payments.confirmation_deadline IS
  'V385: дедлайн подтверждения (paid_at + TTL, по умолчанию 72ч).';
COMMENT ON COLUMN worker_payments.payout_batch_id IS
  'V385: UUID батча для идемпотентности/трассировки выплат.';
