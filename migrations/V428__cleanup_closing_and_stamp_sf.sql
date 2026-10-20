-- ═══════════════════════════════════════════════════════════════════════════
-- V428: очистка мусора в closing_json (D-305)
-- ═══════════════════════════════════════════════════════════════════════════
-- Заказчик 20.10.2026: «почему если есть УПД, акт или чек СЗ, всё равно
-- система пишет что нет СФ. любой закрывающий документ должен закрывать этап».
--
-- Причина: этап закрывался ТОЛЬКО по флагу sf_received_at, а closing_json не
-- учитывался. При этом в closing_json встречается МУСОР, который нельзя
-- считать документом:
--   #521 «запросила»          #690 «Климакин Д.В.»  (ФИО вместо номера)
--   #755 «нет»                #579 «в процессе»
-- Такой мусор надо убрать: иначе либо этап закроется ложно, либо останется
-- вечная задача с непонятным содержимым.
--
-- ЧТО ДЕЛАЕМ:
--   1. Чистим элементы, где номер — мусор/ФИО/пусто. Если после чистки массив
--      пуст — пишем '[]' (этап открыт, задача честно останется).
--   2. Там, где есть РЕАЛЬНЫЙ документ, но sf_received_at пуст — ставим
--      sf_received_at = дата документа (или дату счёта), чтобы флаг совпал
--      с фактом. Это закрывает этап.

BEGIN;

-- 1. Убрать мусорные элементы, сохранив реальные.
UPDATE doc_registry d
   SET closing_json = COALESCE((
         SELECT jsonb_agg(e)
           FROM jsonb_array_elements(
                  CASE WHEN jsonb_typeof(d.closing_json)='array' THEN d.closing_json ELSE '[]'::jsonb END) e
          WHERE COALESCE(trim(e->>'no'), '') <> ''
            AND length(trim(e->>'no')) > 1
            AND lower(trim(e->>'no')) !~ '^(нет|не т|запросила?|запрошен|в процессе|ожидаем?|жд[её]м|позже|потом|—|-|\.*)$'
            AND trim(e->>'no') !~ '^[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.'
       ), '[]'::jsonb),
       updated_at = NOW()
 WHERE d.deleted_at IS NULL
   AND jsonb_typeof(d.closing_json) = 'array'
   AND jsonb_array_length(d.closing_json) > 0
   AND EXISTS (
         SELECT 1 FROM jsonb_array_elements(d.closing_json) e
          WHERE COALESCE(trim(e->>'no'), '') = ''
             OR length(trim(e->>'no')) <= 1
             OR lower(trim(e->>'no')) ~ '^(нет|не т|запросила?|запрошен|в процессе|ожидаем?|жд[её]м|позже|потом|—|-|\.*)$'
             OR trim(e->>'no') ~ '^[А-ЯЁ][а-яё]+\s+[А-ЯЁ]\.'
       );

-- 2. Где реали документ, но флаг пуст — выставить флаг (этап закрыт).
UPDATE doc_registry d
   SET sf_received_at = COALESCE(
         (SELECT MIN((e->>'date')::date)
            FROM jsonb_array_elements(d.closing_json) e
           WHERE (e->>'date') ~ '^\d{4}-\d{2}-\d{2}'),
         COALESCE(d.invoice_date, d.created_at::date)
       ),
       updated_at = NOW()
 WHERE d.deleted_at IS NULL
   AND d.sf_received_at IS NULL
   AND jsonb_typeof(d.closing_json) = 'array'
   AND jsonb_array_length(d.closing_json) > 0;

COMMIT;
