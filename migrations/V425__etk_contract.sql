-- ═══════════════════════════════════════════════════════════════════════════
-- V425: договор ООО «Электротехническая компания» + привязка её счетов
-- ═══════════════════════════════════════════════════════════════════════════
-- Заказчик 20.10.2026: «Создам запись с номером 56201 от 01.06.2026 и привяжу
-- 3 счёта» — подтвердил создание.
--
-- КОНТЕКСТ. У ЭТК (ИНН 3015042714) в справочнике договоров не было НИ ОДНОГО
-- (0 записей по её ИНН). При этом четыре её счёта ссылаются на «договор
-- № 56201 от 01.06.2026» — это ИХ договор, не наш.
--
-- ПОЧЕМУ НОМЕР 56201 ВСТРЕЧАЕТСЯ ДВАЖДЫ. У ООО «ТМХ-ЭЛЕКТРОТЕХ»
-- (ИНН 7704469592) тоже есть договор 56201 (contracts.id=26) — это ДРУГОЕ
-- юрлицо со своим договором. Совпадение номеров между контрагентами —
-- нормальная практика нумерации, поэтому сопоставление обязано идти по паре
-- «номер + контрагент». Именно на этом ошибся старый matchContract (D-299).
--
-- ═══ ФАКТИЧЕСКОЕ ЧИСЛО СЧЕТОВ: 4, а не 3 ═══
--   1523  ДС-26027738    3 305,00 ₽  (ИНН заполнен)
--   1544  ДС-00015800    1 663,00 ₽  (ИНН пуст)
--   1563  БР-000010073   1 130,00 ₽  (ИНН пуст)
--   1574  ДС-00015152       23,34 ₽  (ИНН пуст)
-- Итого 6 121,34 ₽. Попутно заполняем ИНН у трёх строк — без него они не
-- связываются ни с поставщиком, ни с договором.

BEGIN;

-- 1. Договор ЭТК. Идемпотентно: создаём только если такого ещё нет.
INSERT INTO contracts (
  number, type, counterparty_id, counterparty_name, subject,
  start_date, status, created_by, comment,
  customer_inn, customer_name, currency, vat_pct, responsible)
SELECT
  '56201',
  'supplier',
  '3015042714',                          -- counterparty_id в этой таблице хранит ИНН (так у id=26)
  'ООО "Электротехническая компания"',
  'Поставка электротехнической продукции и расходных материалов (АГПЗ)',
  '2026-06-01'::date,                    -- дата договора из счёта: 01.06.2026
  'active',
  3471,                                   -- Тумаева: по решению заказчика документы АГПЗ на ней
  'Создан вручную 20.10.2026 (D-299): договор поставщика из счетов ЭТК. Номер 56201 совпадает с договором ООО «ТМХ-ЭЛЕКТРОТЕХ» — это разные юрлица.',
  '3015042714',
  'ООО "Электротехническая компания"',
  'RUB', 22, 'Тумаева В.'
WHERE NOT EXISTS (
  SELECT 1 FROM contracts
   WHERE regexp_replace(COALESCE(customer_inn,''), '\D', '', 'g') = '3015042714'
     AND regexp_replace(COALESCE(number,''), '[^0-9]', '', 'g') = '56201'
);

-- 2. Заполнить ИНН у трёх счетов ЭТК, где он пуст
--    (без ИНН они не связываются ни с поставщиком suppliers.id=459, ни с договором).
UPDATE doc_registry
   SET counterparty_inn = '3015042714',
       updated_at = NOW()
 WHERE deleted_at IS NULL
   AND counterparty_inn IS NULL
   AND counterparty_name ILIKE '%электротехническая%';

-- 3. Привязать все 4 счёта ЭТК к новому договору.
--    Условие строгое: привязываем только если ИНН документа = ИНН договора.
UPDATE doc_registry d
   SET contract_id = c.id,
       contract_mode = 'linked',
       contract_label = '56201',
       updated_at = NOW()
  FROM contracts c
 WHERE d.deleted_at IS NULL
   AND regexp_replace(COALESCE(d.counterparty_inn,''), '\D', '', 'g') = '3015042714'
   AND regexp_replace(COALESCE(c.customer_inn,''), '\D', '', 'g') = '3015042714'
   AND regexp_replace(COALESCE(c.number,''), '[^0-9]', '', 'g') = '56201'
   AND (d.contract_id IS NULL OR d.contract_id <> c.id);

-- 4. Подтянуть supplier_id из справочника, если удалось связать по ИНН.
UPDATE doc_registry d
   SET supplier_id = s.id,
       updated_at = NOW()
  FROM suppliers s
 WHERE d.deleted_at IS NULL
   AND d.supplier_id IS NULL
   AND regexp_replace(COALESCE(d.counterparty_inn,''), '\D', '', 'g') = '3015042714'
   AND s.name ILIKE '%электротехническая%';

-- 5. У поставщика 459 пустой ИНН — заполним, чтобы связывание работало стабильно.
UPDATE suppliers
   SET inn = '3015042714',
       updated_at = NOW()
 WHERE id = 459
   AND (inn IS NULL OR trim(inn) = '');

COMMIT;

-- ПРОВЕРКА (читателем):
--   SELECT id, number, counterparty_name, customer_inn FROM contracts
--    WHERE regexp_replace(COALESCE(customer_inn,''),'\D','','g')='3015042714';
--   SELECT id, invoice_number, contract_id, contract_mode, supplier_id, counterparty_inn
--     FROM doc_registry WHERE counterparty_inn='3015042714' AND deleted_at IS NULL;
--   -- Контроль: ни один документ не должен иметь ИНН, отличный от ИНН договора:
--   SELECT count(*) FROM doc_registry d JOIN contracts c ON c.id=d.contract_id
--    WHERE d.deleted_at IS NULL AND d.counterparty_inn <> '' AND c.customer_inn <> ''
--      AND regexp_replace(d.counterparty_inn,'\D','','g')
--          <> regexp_replace(c.customer_inn,'\D','','g');
