-- V350: сразу / отложенная оплата + нормализация комментария
ALTER TABLE payment_invoices
  ADD COLUMN IF NOT EXISTS pay_timing VARCHAR(16) NOT NULL DEFAULT 'immediate';
  -- immediate | deferred

COMMENT ON COLUMN payment_invoices.pay_timing IS 'immediate = оплатить сразу после DIR; deferred = одобрено, ждёт даты';
