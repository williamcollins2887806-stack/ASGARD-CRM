-- Ремонт заявок, сконвертированных из телефонии.
--
-- Что пошло не так: SQL передавался через ssh, кириллический литерал 'Звонок'
-- превратился в '????????????'. Затем «починка» через join tender×call без
-- связи размножила строки (7311 знаков мусора в описании).
--
-- Правильный источник — сами звонки этой заявки:
--   1) привязать непривязанные звонки клиента к заявке по номеру телефона;
--   2) пересобрать work_description из ai_summary каждого звонка.
-- Идемпотентно.

BEGIN;

-- 1. Привязка звонков к заявке по нормализованному номеру клиента.
--    Только «головные» звонки (не GSM-плечи) и только когда телефон
--    однозначно соответствует одной phone-заявке.
CREATE TEMP TABLE _pt_phone ON COMMIT DROP AS
SELECT right(regexp_replace(COALESCE(contact_phone, ''), '\D', '', 'g'), 10) AS d10,
       MIN(id) AS pt_id,
       COUNT(*) AS n
FROM pre_tender_requests
WHERE source_type = 'phone'
  AND COALESCE(status, '') NOT IN ('rejected', 'expired')
GROUP BY 1
HAVING COUNT(*) = 1;

UPDATE call_history ch
SET pre_tender_id = p.pt_id,
    updated_at = NOW()
FROM _pt_phone p
WHERE ch.pre_tender_id IS NULL
  AND ch.parent_call_id IS NULL
  AND right(regexp_replace(COALESCE(ch.client_number, ''), '\D', '', 'g'), 10) = p.d10
  AND COALESCE(ch.direction, ch.call_type) = 'inbound';

-- 2. Пересборка описания: по звонку на строку, в хронологии.
CREATE TEMP TABLE _pt_desc ON COMMIT DROP AS
SELECT ch.pre_tender_id AS pt_id,
       STRING_AGG(
         'Звонок ' || to_char(COALESCE(ch.started_at, ch.created_at) AT TIME ZONE 'Europe/Moscow',
                              'DD.MM.YYYY HH24:MI')
         || ' (' || COALESCE(ch.duration_seconds, 0) || ' c): '
         || COALESCE(NULLIF(ch.ai_summary, ''), 'без резюме'),
         chr(10) ORDER BY COALESCE(ch.started_at, ch.created_at)
       ) AS rebuilt,
       COUNT(*) AS calls_n
FROM call_history ch
WHERE ch.pre_tender_id IS NOT NULL
  AND ch.parent_call_id IS NULL
  AND COALESCE(ch.direction, ch.call_type) = 'inbound'
GROUP BY ch.pre_tender_id;

UPDATE pre_tender_requests pt
SET work_description = d.rebuilt,
    updated_at = NOW()
FROM _pt_desc d
WHERE pt.id = d.pt_id
  AND pt.source_type = 'phone';

COMMIT;

SELECT pt.id,
       pt.contact_phone,
       char_length(pt.work_description) AS len,
       (pt.work_description ~ '\?{2,}') AS still_broken,
       (SELECT COUNT(*) FROM call_history c WHERE c.pre_tender_id = pt.id) AS calls,
       substr(pt.work_description, 1, 60) AS head
FROM pre_tender_requests pt
WHERE pt.source_type = 'phone'
  AND pt.created_at >= '2026-11-05'
ORDER BY pt.id;
