-- V411: ПАРТИЯ счетов на согласование (заказчик 19.10.2026).
--
-- Запрос: «если нужно согласовать 10 счетов — 10 разных заявок или можно загрузить
-- 10 и отправить разом? директор может выборочно согласовать, а часть нет?»
-- Ответ: ОДНА заявка = ПАРТИЯ счетов. Директор видит список, ставит галочки и
-- решает по КАЖДОМУ счёту отдельно.
--
-- Почему не «10 отдельных заявок»: директору нужно видеть пачку как одно действие
-- (одно письмо, один экран), но решение принимает по каждому счёту — иначе нельзя
-- отклонить один сомнительный счёт, не отклонив остальные.
--
-- Реализация:
--   • payment_batches — «шапка» партии (кто отправил, когда, статус, комментарий);
--   • payment_invoices.batch_id — счёт принадлежит партии (NULL = одиночный);
--   • решение по каждому счёту остаётся в payment_invoices.status (awaiting_dir →
--     pending_payment / rejected), поэтому выборочность бесплатна.

CREATE TABLE IF NOT EXISTS payment_batches (
  id            SERIAL PRIMARY KEY,
  created_by    integer NOT NULL REFERENCES users(id),
  title         varchar(200),
  comment_text  text,
  total_amount  numeric(16,2) NOT NULL DEFAULT 0,
  invoices_count integer NOT NULL DEFAULT 0,
  status        varchar(24) NOT NULL DEFAULT 'awaiting_dir',
  -- awaiting_dir | partially_approved | approved | rejected | mixed
  dir_approved_at     timestamp,
  dir_approved_by     integer REFERENCES users(id),
  expires_at    timestamp,
  created_at    timestamp NOT NULL DEFAULT NOW(),
  updated_at    timestamp NOT NULL DEFAULT NOW()
);

ALTER TABLE payment_invoices
  ADD COLUMN IF NOT EXISTS batch_id integer REFERENCES payment_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_invoices_batch
  ON payment_invoices (batch_id) WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_batches_status
  ON payment_batches (status, created_at DESC);

COMMENT ON TABLE payment_batches IS
  'V411: партия счетов на согласование. Директор решает по КАЖДОМУ счёту (выборочно).';
COMMENT ON COLUMN payment_invoices.batch_id IS
  'V411: партия, в которой пришёл счёт. NULL — одиночная заявка.';

-- Разрешаем загружать счёт без суммы на этапе OCR (сумма появится после разбора).
-- Раньше POST / требовал amount > 0 — при потоковой загрузке сумма ещё неизвестна.
COMMENT ON COLUMN payment_invoices.amount IS
  'Сумма счёта. На этапе загрузки может быть 0 до завершения OCR (V411).';
