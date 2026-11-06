-- Конвертация ошибочных саг из телефонии в заявки маркетплейса.
--
-- Контекст (06.11.2026): до фикса V467 call-analyzer писал `INSERT INTO tenders`
-- (source='phone_call'). Один клиент позвонил дважды — получилось два тендера
-- #2154 и #2155, оба попали дежурному РП на анализ.
--
-- Скрипт: на каждого клиента (по call_history.client_number) создаёт ОДНУ
-- pre_tender_requests, привязывает все звонки, тендеры отправляет в soft-delete.
-- Идемпотентен: повторный прогон ничего не дублирует (для группы, у которой
-- уже есть заявка с этим телефоном, используется она).
--
-- Запускать на проде после snapshot.

BEGIN;

-- 1. Группы тендеров из звонков с телефоном клиента.
CREATE TEMP TABLE phone_tender_groups ON COMMIT DROP AS
SELECT
  right(regexp_replace(COALESCE(ch.client_number, ''), '\D', '', 'g'), 10) AS digits,
  MIN(t.id) AS first_tender_id,
  ARRAY_AGG(t.id ORDER BY t.created_at) AS tender_ids,
  (ARRAY_AGG(t.customer_name ORDER BY LENGTH(COALESCE(t.customer_name, '')) DESC))[1] AS customer_name,
  (ARRAY_AGG(t.tender_title ORDER BY LENGTH(COALESCE(t.tender_title, '')) DESC))[1] AS work_title,
  (ARRAY_AGG(t.tender_region ORDER BY LENGTH(COALESCE(t.tender_region, '')) DESC))[1] AS work_location,
  (ARRAY_AGG(t.created_by ORDER BY t.created_at) FILTER (WHERE t.created_by IS NOT NULL))[1] AS created_by,
  STRING_AGG(
    'Звонок ' || to_char(COALESCE(ch.started_at, t.created_at) AT TIME ZONE 'Europe/Moscow',
                         'DD.MM.YYYY HH24:MI')
    || ' (' || COALESCE(ch.duration_seconds, 0) || ' c): '
    || COALESCE(NULLIF(t.comment_to, ''), t.tender_title, 'без описания'),
    E'\n' ORDER BY COALESCE(ch.started_at, t.created_at)
  ) AS history_text,
  (ARRAY_AGG(COALESCE(NULLIF(t.comment_to, ''), t.tender_title)
     ORDER BY COALESCE(ch.started_at, t.created_at) DESC))[1] AS ai_summary
FROM tenders t
LEFT JOIN call_history ch ON ch.lead_id = t.id
WHERE t.deleted_at IS NULL
  AND t.source = 'phone_call'
  AND COALESCE(ch.client_number, '') <> ''
GROUP BY right(regexp_replace(COALESCE(ch.client_number, ''), '\D', '', 'g'), 10)
HAVING right(regexp_replace(COALESCE(ch.client_number, ''), '\D', '', 'g'), 10) <> '';

-- 2. Заявка маркетплейса на группу: переиспользовать существующую, иначе создать.
CREATE TEMP TABLE phone_tender_map ON COMMIT DROP AS
SELECT g.digits, g.first_tender_id, g.tender_ids,
       COALESCE(
         (SELECT pt.id FROM pre_tender_requests pt
           WHERE right(regexp_replace(COALESCE(pt.contact_phone, ''), '\D', '', 'g'), 10) = g.digits
             AND COALESCE(pt.status, '') NOT IN ('rejected', 'expired')
           ORDER BY pt.created_at DESC LIMIT 1),
         NULL
       ) AS existing_pt_id,
       g.customer_name, g.work_title, g.work_location, g.created_by,
       g.history_text, g.ai_summary
FROM phone_tender_groups g;

INSERT INTO pre_tender_requests (
  source_type, customer_name, contact_phone, work_title, work_description,
  work_location, ai_summary, ai_color, status, created_by,
  has_documents, created_at, updated_at
)
SELECT
  'phone', m.customer_name, m.digits, LEFT(m.work_title, 200),
  m.history_text, m.work_location, LEFT(m.ai_summary, 2000),
  'yellow', 'new', m.created_by,
  false, NOW(), NOW()
FROM phone_tender_map m
WHERE m.existing_pt_id IS NULL;

-- 3. Проставить id заявки в карту (для только что созданных).
UPDATE phone_tender_map m
SET existing_pt_id = pt.id
FROM pre_tender_requests pt
WHERE m.existing_pt_id IS NULL
  AND right(regexp_replace(COALESCE(pt.contact_phone, ''), '\D', '', 'g'), 10) = m.digits
  AND COALESCE(pt.status, '') NOT IN ('rejected', 'expired');

-- 4. Все звонки группы → на эту заявку.
-- Без временной границы: created_at тендера всегда ПОЗЖЕ звонка, поэтому
-- фильтр по нему терял первый (самый ранний) звонок группы.
UPDATE call_history ch
SET pre_tender_id = m.existing_pt_id,
    updated_at = NOW()
FROM phone_tender_map m
WHERE m.existing_pt_id IS NOT NULL
  AND (
    ch.lead_id = ANY(m.tender_ids)
    OR right(regexp_replace(COALESCE(ch.client_number, ''), '\D', '', 'g'), 10) = m.digits
  );

-- 5. Тендеры — в soft-delete, lead_id отвязываем.
UPDATE call_history SET lead_id = NULL
WHERE lead_id = ANY(SELECT UNNEST(tender_ids) FROM phone_tender_map);

UPDATE tenders t
SET deleted_at = NOW(), updated_at = NOW()
FROM phone_tender_map m
WHERE t.id = ANY(m.tender_ids)
  AND t.deleted_at IS NULL;

-- 6. Пустые отзывы (без отчёта) по этим тендерам — убрать из очереди.
DELETE FROM tender_rp_review_collaborators c
USING tender_rp_reviews rev, phone_tender_map m
WHERE c.review_id = rev.id
  AND rev.tender_id = ANY(m.tender_ids)
  AND rev.is_final IS NOT TRUE
  AND rev.analysis_finalized_at IS NULL;

DELETE FROM tender_rp_reviews rev
USING phone_tender_map m
WHERE rev.tender_id = ANY(m.tender_ids)
  AND rev.is_final IS NOT TRUE
  AND rev.analysis_finalized_at IS NULL;

-- 7. Отчёт: что куда переехало.
SELECT m.tender_ids AS tenders_soft_deleted,
       m.digits AS client_phone,
       m.existing_pt_id AS pre_tender_id,
       m.customer_name,
       LEFT(m.work_title, 60) AS title
FROM phone_tender_map m
ORDER BY m.existing_pt_id;

COMMIT;
