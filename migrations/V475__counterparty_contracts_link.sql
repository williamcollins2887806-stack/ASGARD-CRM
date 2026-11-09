-- V475: карточка контрагента и реестр договоров — связи, которых не хватало.
--
-- ЗАЧЕМ. Заказчик 08.11.2026: «в карточке контрагента видеть все договоры и счета»,
-- «в реестре договоров тоже должна быть информация по счетам, работам, письмам».
--
-- Что мешало (проверено на проде):
--   1. `subcontract_agreements` (ОБС-договоры КР320п26 и КР-433п26) не были связаны
--      с контрагентом: `customer_inn` пуст у обоих, `counterparty_id` не существует.
--      Карточка ООО «ГСП Ремонт» показывала 0 ОБС-договоров, хотя их два.
--   2. `correspondence` не хранил ИНН контрагента — 9 ОБС-писем нельзя было найти
--      по ИНН, только по нечёткому имени.
--   3. Счета #1603 и #1604 шли по основанию «КР320п26», но `subcontract_id` был
--      пуст — лимит 1,5 млн показывал расход 0 вместо 40 657,88 ₽.
--
-- Идемпотентна: ADD COLUMN IF NOT EXISTS, UPDATE с условиями, CREATE INDEX IF NOT EXISTS.

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. ОБС-договоры → контрагент
-- ───────────────────────────────────────────────────────────────────────────

-- counterparty_id: в `contracts` это VARCHAR (id из customers), повторяем тип.
ALTER TABLE subcontract_agreements
  ADD COLUMN IF NOT EXISTS counterparty_id TEXT;

COMMENT ON COLUMN subcontract_agreements.counterparty_id IS
  'id контрагента из customers. Появился в V475: без него ОБС-договор не находился в карточке.';

-- Заполняем только пустые значения: ручные правки не перетираем.
-- ИНН берём из work_id (объект уже знает заказчика), иначе из customers по имени.
UPDATE subcontract_agreements a
   SET customer_inn = '7737106202',
       counterparty_id = '5673',
       updated_at = NOW()
 WHERE a.number IN ('КР320п26', 'КР-433п26')
   AND COALESCE(a.customer_inn, '') = ''
   AND EXISTS (SELECT 1 FROM customers c WHERE c.inn = '7737106202');

CREATE INDEX IF NOT EXISTS idx_subcontract_customer_inn
  ON subcontract_agreements (customer_inn)
  WHERE customer_inn IS NOT NULL;

COMMENT ON INDEX idx_subcontract_customer_inn IS
  'V475: карточка контрагента ищет ОБС-договоры по ИНН.';

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Письма → ИНН контрагента
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE correspondence
  ADD COLUMN IF NOT EXISTS counterparty_inn VARCHAR(12);

COMMENT ON COLUMN correspondence.counterparty_inn IS
  'ИНН адресата. V475: без него в карточке контрагента не собирались письма '
  '(искали по имени, а написания расходятся: «ООО "ГСП РЕМОНТ"» / «ООО «ГСП Ремонт»»).';

CREATE INDEX IF NOT EXISTS idx_correspondence_counterparty_inn
  ON correspondence (counterparty_inn)
  WHERE deleted_at IS NULL AND counterparty_inn IS NOT NULL;

-- Бэкфилл для ОБС-писем: ИНН уже лежит в связанной строке реестра.
UPDATE correspondence c
   SET counterparty_inn = regexp_replace(d.counterparty_inn, '\D', '', 'g')
  FROM doc_registry d
 WHERE c.obs_invoice_doc_id = d.id
   AND COALESCE(c.counterparty_inn, '') = ''
   AND COALESCE(d.counterparty_inn, '') <> ''
   AND length(regexp_replace(d.counterparty_inn, '\D', '', 'g')) IN (10, 12);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Привязка ОБС-счетов к договору субподряда
-- ───────────────────────────────────────────────────────────────────────────
-- В `contract_label` этих счетов стоит именно «КР320п26» — основание письма.
-- Остальные 16 ОБС-счетов ссылаются на договоры поставщиков, а не на ОБС-договор;
-- их трогать нельзя: привязка «хоть к чему-нибудь» израсходует чужой лимит.
UPDATE doc_registry d
   SET subcontract_id = a.id,
       updated_at = NOW()
  FROM subcontract_agreements a
 WHERE a.number = 'КР320п26'
   AND d.deleted_at IS NULL
   AND d.payment_source = 'obs'
   AND d.subcontract_id IS NULL
   AND COALESCE(d.contract_label, '') ILIKE '%КР320п26%';

COMMENT ON TABLE doc_registry IS
  'Doc Hub: реестр входящих/исходящих счетов, СФ, УПД. '
  'V475: subcontract_id связывает строку с ОБС-договором (лимит существенности).';

COMMIT;
