-- ═══════════════════════════════════════════════════════════════════════════
-- V433: пересчитать флаг «дозаполнить» для счетов в оплате без объекта (D-334)
-- ═══════════════════════════════════════════════════════════════════════════
-- Заказчик 21.10.2026: «проверь эти 7 счетов горят как дозаполнить? синие?»
--
-- ДЕФЕКТ: правило `no_work_for_expense` добавлено в calcIncomplete (JS), но
-- применяется ТОЛЬКО при сохранении карточки. Существующие строки не были
-- пересчитаны — флаг висел в старом значении (у 4 из 7 причина была
-- `contract_not_found`, у 3 — вообще ничего).
--
-- Что делаем: пересчитываем `is_incomplete` / `incomplete_reasons` для строк,
-- которые РЕАЛЬНО идут в оплату (есть payment_invoice_id), у них есть сумма,
-- но не выбран объект. Архив без заявки НЕ трогаем — иначе 196 ложных синих
-- (класс D-238).
--
-- Причина `no_work_for_expense` добавляется СОХРАНЯЯ уже имеющиеся причины.

BEGIN;

-- 1. Добавить причину тем, кто подпадает под правило и ещё не имеет её.
UPDATE doc_registry d
   SET incomplete_reasons = (
         SELECT array_agg(DISTINCT x)
           FROM unnest(COALESCE(d.incomplete_reasons, '{}'::text[])
                       || ARRAY['no_work_for_expense']) AS x
       ),
       is_incomplete = true,
       updated_at = NOW()
 WHERE d.deleted_at IS NULL
   AND d.dir = 'in'
   AND d.work_id IS NULL
   AND d.payment_invoice_id IS NOT NULL
   AND d.amount_gross > 0
   AND COALESCE(d.purpose_asgard, false) = false
   AND COALESCE(d.purpose_consumables, false) = false
   AND COALESCE(d.spend_kind, '') <> 'office'
   AND NOT ('no_work_for_expense' = ANY(COALESCE(d.incomplete_reasons, '{}'::text[])));

-- 2. Снять причину у тех, у кого объект появился (правило больше не действует).
UPDATE doc_registry d
   SET incomplete_reasons = (
         SELECT array_agg(x) FROM unnest(d.incomplete_reasons) AS x
          WHERE x <> 'no_work_for_expense'
       ),
       is_incomplete = COALESCE(array_length(
         (SELECT array_agg(x) FROM unnest(d.incomplete_reasons) AS x
           WHERE x <> 'no_work_for_expense'), 1), 0) > 0,
       updated_at = NOW()
 WHERE d.deleted_at IS NULL
   AND 'no_work_for_expense' = ANY(COALESCE(d.incomplete_reasons, '{}'::text[]))
   AND (d.work_id IS NOT NULL
        OR d.payment_invoice_id IS NULL
        OR COALESCE(d.purpose_asgard, false) = true
        OR COALESCE(d.purpose_consumables, false) = true
        OR COALESCE(d.spend_kind, '') = 'office');

COMMIT;

-- ПРОВЕРКА:
--   SELECT id, invoice_number, amount_gross, incomplete_reasons
--     FROM doc_registry
--    WHERE deleted_at IS NULL AND 'no_work_for_expense' = ANY(COALESCE(incomplete_reasons,'{}'))
--    ORDER BY id DESC;
--   -- ожидание: 7 строк (счета в оплате без объекта)
