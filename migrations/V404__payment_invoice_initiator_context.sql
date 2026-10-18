-- V404: заявка на оплату — то, чего не было для бухгалтерии и директора.
--
-- Дефект (проверка заказчика 17.10.2026): заявка не несла:
--   • просьбу инициатора из тела письма («оплати завтра/срочно/через 2 месяца»);
--   • основание-договор из счёта и признак «такого договора в CRM НЕТ»;
--   • объект/работу из счёта;
--   • номер/дату счёта отдельными полями (были только внутри basis_text).
-- Из-за этого директор и бухгалтер видели сумму и поставщика, но не контекст,
-- который инициатор уже написал в письме.

ALTER TABLE payment_invoices
  ADD COLUMN IF NOT EXISTS initiator_intent varchar(24),
  ADD COLUMN IF NOT EXISTS initiator_note text,
  ADD COLUMN IF NOT EXISTS contract_basis_number varchar(64),
  ADD COLUMN IF NOT EXISTS contract_basis_date date,
  ADD COLUMN IF NOT EXISTS contract_missing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS work_hint varchar(200),
  ADD COLUMN IF NOT EXISTS invoice_number varchar(64),
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS vat_amount numeric(16,2);

-- Индекс: бухгалтерия ищет «где договор не найден» (подсветка в реестре).
CREATE INDEX IF NOT EXISTS idx_payment_invoices_contract_missing
  ON payment_invoices (contract_missing) WHERE contract_missing IS TRUE;

-- Индекс: срочные заявки наверх (порядок в таблице бухгалтерии).
CREATE INDEX IF NOT EXISTS idx_payment_invoices_intent
  ON payment_invoices (initiator_intent) WHERE initiator_intent IS NOT NULL;
