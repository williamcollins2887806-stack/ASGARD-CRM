-- V343: снимок реквизитов поставщика/исполнителя в счёте и акте.
-- Конструктор может править реквизиты Асгарда без изменения глобальных настроек.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS issuer_json JSONB;

ALTER TABLE acts
  ADD COLUMN IF NOT EXISTS issuer_json JSONB;

COMMENT ON COLUMN invoices.issuer_json IS 'Реквизиты поставщика на момент документа (снимок из настроек + правки в конструкторе)';
COMMENT ON COLUMN acts.issuer_json IS 'Реквизиты исполнителя на момент документа (снимок из настроек + правки в конструкторе)';
