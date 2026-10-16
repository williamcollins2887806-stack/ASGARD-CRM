-- ============================================================================
-- V401: банковские реквизиты поставщика — для быстрого создания платёжки.
-- ----------------------------------------------------------------------------
-- Требование заказчика (17.10.2026): модалка счёта у бухгалтера должна позволять
-- БЫСТРО скопировать все данные для платёжного поручения: ИНН, КПП, БИК, р/с,
-- к/с, назначение, сумма. В схеме этих полей НЕ было ни в suppliers, ни где-либо.
-- Идемпотентно, аддитивно. Down — V401__..._down.sql.
-- ============================================================================

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bik        VARCHAR(9);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS bank_name  TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS rs         VARCHAR(20);   -- расчётный счёт
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS ks         VARCHAR(20);   -- корреспондентский счёт

-- Платёжное поручение: хранить № ПП и дату отдельно (бухгалтерия копирует в банк).
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS pp_number VARCHAR(40);
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS pp_date   DATE;

-- Снимок реквизитов на момент оплаты: если карточка поставщика изменится,
-- в истории останутся именно те реквизиты, по которым платили.
ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS payee_requisites JSONB;

COMMENT ON COLUMN suppliers.bik IS 'V401: БИК банка (9 цифр) — для платёжного поручения.';
COMMENT ON COLUMN suppliers.rs  IS 'V401: расчётный счёт поставщика (20 цифр).';
COMMENT ON COLUMN suppliers.ks  IS 'V401: корреспондентский счёт (20 цифр).';
COMMENT ON COLUMN payment_invoices.payee_requisites IS
  'V401: снимок реквизитов плательщика на момент оплаты (ИНН/КПП/БИК/р-с/к-с/банк).';
