-- V475 down: откат связей карточки контрагента.
--
-- ВНИМАНИЕ. Данные не восстанавливаются один-к-одному:
--   • customer_inn / counterparty_id у ОБС-договоров были ПУСТЫ до миграции — очищаем;
--   • counterparty_inn у писем был пуст — очищаем;
--   • subcontract_id у счетов #1603/#1604 был пуст — отвязываем.
-- Сами договоры и письма не удаляются: откат только снимает связи.

BEGIN;

UPDATE doc_registry d
   SET subcontract_id = NULL,
       updated_at = NOW()
  FROM subcontract_agreements a
 WHERE a.number = 'КР320п26'
   AND d.subcontract_id = a.id
   AND d.payment_source = 'obs';

ALTER TABLE correspondence DROP COLUMN IF EXISTS counterparty_inn;

DROP INDEX IF EXISTS idx_subcontract_customer_inn;

UPDATE subcontract_agreements
   SET customer_inn = NULL,
       counterparty_id = NULL,
       updated_at = NOW()
 WHERE number IN ('КР320п26', 'КР-433п26');

ALTER TABLE subcontract_agreements DROP COLUMN IF EXISTS counterparty_id;

COMMIT;
