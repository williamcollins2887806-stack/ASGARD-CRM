-- ═══════════════════════════════════════════════════════════════════════════
-- V415: бэкфилл полей заявки, которые ИИ извлёк, но они не доехали (D-287)
-- ═══════════════════════════════════════════════════════════════════════════
-- Письмо #4894 (ООО «Велесстрой», промывка УУКГ, Усть-Луга).
-- ИИ вернул work_type и срок 30.10.2026, но в pre_tender_requests пришло:
--   work_title = «ООО «Велесстрой»»  (имя клиента вместо работы)
--   ai_work_type = ПУСТО, work_deadline = ПУСТО
--   work_description = «-------- Пересылаемое сообщение --------» (мусор форвардера)
-- Восстанавливаем из уже сохранённых данных, ничего не выдумывая.

BEGIN;

-- 1. Название работы: было имя клиента → берём тип работы из разбора ИИ.
UPDATE pre_tender_requests pt
   SET work_title = left(ia.ai_work_type, 200), updated_at = NOW()
  FROM inbox_applications ia
 WHERE ia.email_id = pt.email_id
   AND pt.work_title = pt.customer_name          -- заголовок = только имя клиента
   AND COALESCE(ia.ai_work_type, '') <> '';

-- 2. Тип работы / срок / срочность из разбора ИИ.
UPDATE pre_tender_requests pt
   SET ai_work_type = COALESCE(NULLIF(pt.ai_work_type, ''), ia.ai_work_type),
       updated_at = NOW()
  FROM inbox_applications ia
 WHERE ia.email_id = pt.email_id
   AND COALESCE(pt.ai_work_type, '') = ''
   AND COALESCE(ia.ai_work_type, '') <> '';

-- 3. Срок оплаты/подачи: ИИ указал в ai_summary («в срок до 30.10.2026»).
--    Достаём первую дату формата ДД.ММ.ГГГГ и приводим к date явно:
--    substring(...)::date при русском ДД.ММ ломается, собираем ISO-строку.
UPDATE pre_tender_requests pt
   SET work_deadline = to_date(
         substring(ia.ai_summary from '(\d{2}\.\d{2}\.\d{4})'),
         'DD.MM.YYYY'),
       updated_at = NOW()
  FROM inbox_applications ia
 WHERE ia.email_id = pt.email_id
   AND pt.work_deadline IS NULL
   AND ia.ai_summary ~ '\d{2}\.\d{2}\.\d{4}';

-- 4. Описание: убираем служебную шапку форвардера («-------- Пересылаемое …»),
--    из-за которой карточка открывалась мусором вместо запроса заказчика.
--    Берём от первого осмысленного абзаца (после «Добрый день!» / «Настоящим»).
UPDATE pre_tender_requests pt
   SET work_description = COALESCE(
         NULLIF(substring(pt.work_description from '(Настоящим[\s\S]*)$'), ''),
         NULLIF(substring(pt.work_description from '(Добрый день[\s\S]*)$'), ''),
         pt.work_description),
       updated_at = NOW()
 WHERE pt.work_description ~ '^\s*-{2,}\s*Пересылаемое'
   AND pt.email_id IS NOT NULL;

-- 5. ИНН: если в письме он есть — переносим; иначе оставляем пусто
--    (у «Велесстрой» в письме ИНН не указан — не выдумываем).
UPDATE pre_tender_requests pt
   SET customer_inn = ia.extracted_customer_inn, updated_at = NOW()
  FROM inbox_applications ia
 WHERE ia.email_id = pt.email_id
   AND COALESCE(pt.customer_inn, '') = ''
   AND COALESCE(ia.extracted_customer_inn, '') <> '';

COMMIT;
