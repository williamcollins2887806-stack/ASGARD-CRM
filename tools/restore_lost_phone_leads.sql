-- Восстановление заявок, потерянных при первом (слепом) soft-delete телефонии
-- 05.11.2026: тендеры удалили, а заявку в маркетплейсе не создали.
--
-- Условие: целевой входящий звонок клиента, у которого НЕТ ни одной
-- phone-заявки. Создаём по одной заявке на клиента с историей всех его звонков.
-- Идемпотентно.

BEGIN;

CREATE TEMP TABLE _missing ON COMMIT DROP AS
WITH calls AS (
  SELECT
    right(regexp_replace(COALESCE(ch.client_number, ''), '\D', '', 'g'), 10) AS d10,
    ch.*
  FROM call_history ch
  WHERE ch.parent_call_id IS NULL
    AND COALESCE(ch.direction, ch.call_type) = 'inbound'
    AND ch.ai_is_target = true
    AND COALESCE(ch.client_number, '') <> ''
    AND ch.pre_tender_id IS NULL
    AND ch.created_at >= '2026-11-05'
)
SELECT
  c.d10,
  MAX(c.client_number) AS phone,
  STRING_AGG(
    'Звонок ' || to_char(COALESCE(c.started_at, c.created_at) AT TIME ZONE 'Europe/Moscow',
                         'DD.MM.YYYY HH24:MI')
    || ' (' || COALESCE(c.duration_seconds, 0) || ' c): '
    || COALESCE(NULLIF(c.ai_summary, ''), 'без резюме'),
    chr(10) ORDER BY COALESCE(c.started_at, c.created_at)
  ) AS history_text,
  (ARRAY_AGG(COALESCE(NULLIF(c.ai_summary, ''), 'Заявка из звонка')
     ORDER BY COALESCE(c.started_at, c.created_at)))[1] AS first_summary,
  MAX(c.user_id) AS created_by
FROM calls c
WHERE NOT EXISTS (
  SELECT 1 FROM pre_tender_requests pt
   WHERE right(regexp_replace(COALESCE(pt.contact_phone, ''), '\D', '', 'g'), 10) = c.d10
)
GROUP BY c.d10;

INSERT INTO pre_tender_requests (
  source_type, customer_name, contact_phone, work_title, work_description,
  ai_summary, ai_color, status, created_by, has_documents, created_at, updated_at
)
SELECT
  'phone',
  'Из звонка',
  m.phone,
  LEFT(m.first_summary, 200),
  m.history_text,
  LEFT(m.first_summary, 2000),
  'yellow', 'new', m.created_by, false, NOW(), NOW()
FROM _missing m;

UPDATE call_history ch
SET pre_tender_id = pt.id,
    updated_at = NOW()
FROM pre_tender_requests pt
WHERE ch.pre_tender_id IS NULL
  AND ch.parent_call_id IS NULL
  AND COALESCE(ch.direction, ch.call_type) = 'inbound'
  AND ch.created_at >= '2026-11-05'
  AND right(regexp_replace(COALESCE(ch.client_number, ''), '\D', '', 'g'), 10)
    = right(regexp_replace(COALESCE(pt.contact_phone, ''), '\D', '', 'g'), 10)
  AND pt.source_type = 'phone';

COMMIT;

SELECT pt.id, pt.contact_phone, pt.work_title,
       (SELECT COUNT(*) FROM call_history c WHERE c.pre_tender_id = pt.id) AS calls,
       substr(pt.work_description, 1, 60) AS head
FROM pre_tender_requests pt
WHERE pt.source_type = 'phone' AND pt.created_at >= '2026-11-05'
ORDER BY pt.id;
