-- ═══════════════════════════════════════════════════════════════════════════
-- V413: бэкфилл дефектов распознавания (D-283, аудит почты 19.10.2026)
-- ═══════════════════════════════════════════════════════════════════════════
-- Код исправлен (shell 20.28.241), но 5 счетов, пришедших ДО фикса, остались
-- с дефектами. Чиним данные, ничего не выдумывая — только то, что уже есть
-- в doc_email_intake.parse_raw и в датах счёта.
--
-- Идемпотентно: повторный прогон ничего не меняет (условия WHERE).

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1. НДС 9.91% (АэроОтель №1388) — такой ставки в НК РФ нет.
--    Выводим из сумм: 100 × 757.38 / (8400 − 757.38) = 9.91 → ближайшая 10.
--    Сумма НДС (757.38) НЕ трогается — она верна, врёт только ставка.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE payment_invoices
   SET vat_rate = 10, updated_at = NOW()
 WHERE vat_rate IS NOT NULL
   AND vat_rate::numeric NOT IN (0, 5, 7, 10, 20, 22)
   AND amount > 0 AND vat_amount > 0 AND amount > vat_amount
   AND ABS(10 - ROUND((100 * vat_amount / (amount - vat_amount))::numeric, 2)) < 0.5;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Позиции: восстанавливаем из parse_raw (там они распознаны верно).
--    НЕ выдумываем: берём ровно сохранённый массив lines.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE payment_invoices pi
   SET line_items_json = dei.parse_raw::jsonb -> 'lines',
       updated_at = NOW()
  FROM doc_email_intake dei
 WHERE dei.invoice_number = pi.invoice_number
   AND jsonb_array_length(COALESCE(dei.parse_raw::jsonb -> 'lines', '[]'::jsonb)) > 0
   AND (pi.line_items_json IS NULL OR pi.line_items_json::text IN ('[]', 'null'));

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Срок оплаты: счёт не печатает срок → оцениваем от даты счёта + 10 дней.
--    Счёт №1353 от 01.10 уже просрочен — это должно стать видно светофору.
-- ───────────────────────────────────────────────────────────────────────────
UPDATE payment_invoices
   SET due_date = (invoice_date + INTERVAL '10 days')::date,
       updated_at = NOW()
 WHERE due_date IS NULL
   AND invoice_date IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. supplier_id: фолбэк по точному названию, когда ИНН в счёте ≠ ИНН в справочнике.
--    Расхождение НЕ прячем — пишем в parse_warnings реестра.
--    Реальный случай: АэроОтель 2901264958 (Архангельск) vs 7014049295 (Томск).
-- ───────────────────────────────────────────────────────────────────────────
UPDATE payment_invoices pi
   SET supplier_id = s.id, updated_at = NOW()
  FROM suppliers s
 WHERE pi.supplier_id IS NULL
   AND pi.supplier_name IS NOT NULL
   AND s.deleted_at IS NULL
   AND lower(regexp_replace(trim(s.name), '^ооо\s+|^"|"+$', '', 'gi'))
     = lower(regexp_replace(trim(pi.supplier_name), '^ооо\s+|^"|"+$', '', 'gi'));

UPDATE doc_registry d
   SET parse_warnings = COALESCE(d.parse_warnings, '[]'::jsonb)
       || jsonb_build_array(jsonb_build_object(
            'code', 'supplier_inn_mismatch',
            'note', 'связано по названию, ИНН в документе ' || COALESCE(d.counterparty_inn, '?')
                    || ', в справочнике ' || COALESCE(s.inn, '?'),
            'at', to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SSOF'))),
       updated_at = NOW()
  FROM payment_invoices pi
  JOIN suppliers s ON s.id = pi.supplier_id
 WHERE d.payment_invoice_id = pi.id
   AND pi.supplier_id IS NOT NULL
   AND d.counterparty_inn IS NOT NULL
   AND s.inn IS NOT NULL
   AND d.counterparty_inn <> s.inn
   AND NOT (COALESCE(d.parse_warnings, '[]'::jsonb) @> jsonb_build_array(jsonb_build_object('code', 'supplier_inn_mismatch')));

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Название контрагента: незакрытая внешняя кавычка.
--    `ООО "ТД "БАШПРОМТОРГ"` → `ООО "ТД БАШПРОМТОРГ"` (3 кавычки → 2).
--    Та же логика, что в src/lib/item-name-clean.js (tidyOrgName).
-- ───────────────────────────────────────────────────────────────────────────
UPDATE payment_invoices
   SET supplier_name = regexp_replace(
         regexp_replace(supplier_name, '^(.{2,40}?)\s+"([^"]{1,60}?)\s+"([^"]{1,120})"?$', '\1 "\2 \3"'),
         '\s+', ' ', 'g'),
       updated_at = NOW()
 WHERE supplier_name IS NOT NULL
   AND (length(supplier_name) - length(replace(supplier_name, '"', ''))) % 2 = 1;

UPDATE doc_registry d
   SET counterparty_name = regexp_replace(
         regexp_replace(d.counterparty_name, '^(.{2,40}?)\s+"([^"]{1,60}?)\s+"([^"]{1,120})"?$', '\1 "\2 \3"'),
         '\s+', ' ', 'g'),
       updated_at = NOW()
  FROM payment_invoices pi
 WHERE d.payment_invoice_id = pi.id
   AND d.counterparty_name IS NOT NULL
   AND (length(d.counterparty_name) - length(replace(d.counterparty_name, '"', ''))) % 2 = 1;

COMMIT;
