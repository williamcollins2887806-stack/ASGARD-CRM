-- ═══════════════════════════════════════════════════════════════════════════
-- V423: тип закрывающего документа + фикс битой арифметики НДС
-- ═══════════════════════════════════════════════════════════════════════════
-- D-298 (заказчик 20.10.2026): «Надо добавить выбор УПД, акт или иной документ,
-- например чек, СЗ».
--
-- Сейчас closing_json хранит массив объектов {kind, no, date}, но kind был
-- свободным текстом: встречаются 'СФ', 'УПД', 'Акт', 'Чек' — без справочника,
-- поэтому в UI нельзя дать нормальный выбор. Вводим единый перечень.
--
-- Побочно: строка #1525 (ИП Ирушкина) имеет has_vat=false, но vat_amount=8353 —
-- арифметика gross != net + vat. Это пришло из прошлого импорта.

BEGIN;

-- 1. Справочник типов закрывающих документов (для селекта в UI).
INSERT INTO settings (key, value_json, updated_at)
VALUES ('doc_closing_kinds', '["СФ","УПД","Акт","Чек","СЗ","ТОРГ-12","Иное"]'::jsonb, NOW())
ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = NOW();

-- 2. Фикс строки с битой арифметикой: без НДС → vat_amount = 0, net = gross.
UPDATE doc_registry
   SET amount_net = amount_gross,
       vat_amount = 0,
       vat_rate = 0,
       updated_at = NOW()
 WHERE deleted_at IS NULL
   AND has_vat IS FALSE
   AND ABS(amount_gross - (amount_net + vat_amount)) >= 0.02;

-- 3. Привести kind в closing_json к справочнику (на случай самописных значений).
UPDATE doc_registry
   SET closing_json = (
         SELECT jsonb_agg(
           elem || jsonb_build_object('kind',
             CASE
               WHEN upper(coalesce(elem->>'kind','')) LIKE '%УПД%' THEN 'УПД'
               WHEN upper(coalesce(elem->>'kind','')) LIKE '%АКТ%' THEN 'Акт'
               WHEN upper(coalesce(elem->>'kind','')) LIKE '%ЧЕК%' THEN 'Чек'
               WHEN upper(coalesce(elem->>'kind','')) LIKE '%СЗ%' THEN 'СЗ'
               WHEN upper(coalesce(elem->>'kind','')) LIKE '%ТОРГ%' THEN 'ТОРГ-12'
               WHEN upper(coalesce(elem->>'kind','')) LIKE '%СФ%'
                 OR upper(coalesce(elem->>'kind','')) LIKE '%СЧЕТ-ФАКТ%' THEN 'СФ'
               ELSE 'Иное'
             END))
         FROM jsonb_array_elements(closing_json) elem
       ),
       updated_at = NOW()
 WHERE deleted_at IS NULL
   AND closing_json IS NOT NULL
   AND jsonb_typeof(closing_json) = 'array'
   AND jsonb_array_length(closing_json) > 0;

COMMIT;
