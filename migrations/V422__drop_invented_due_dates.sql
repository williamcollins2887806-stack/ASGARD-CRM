-- ═══════════════════════════════════════════════════════════════════════════
-- V422: убрать ВЫДУМАННЫЕ сроки оплаты (D-294, вариант C заказчика)
-- ═══════════════════════════════════════════════════════════════════════════
-- Заказчик 20.10.2026: «сейчас нужно починить что сломано чтобы не выдумывало
-- и реально ставила срок» → вариант C: если счёта срока не содержит, поле
-- остаётся ПУСТЫМ, срок ставит инициатор руками.
--
-- Доказательство выдумки (аудит 20.10.2026):
--   payment_invoices due_date = invoice_date + ровно 10 дней у 4 заявок,
--   при этом doc_email_intake.parse_raw->>'payment_due_at' = null,
--   т.е. в самом документе срока нет. Формулу ставили:
--     • миграция V413 п.3 (invoice_date + INTERVAL '10 days');
--     • doc-email-intake.js (invoice_date + settings.doc_due_days).
--
-- ЧТО ЧИСТИМ: только заведомо вычисленные — когда одновременно
--   1) срок в заявке ровно +10 дней от даты счёта,
--   2) ИИ/парсер срока НЕ нашёл (parse_raw.payment_due_at = null).
-- Если срок пришёл из документа — он остаётся.
--
-- ВАЖНО: таблица со сроками от заказчика будет загружена отдельно; это очистка,
-- а не заполнение. Пустой срок честнее выдуманного: светофор и напоминания
-- перестанут давать ложные просрочки.

BEGIN;

-- 1. Заявки на оплату.
UPDATE payment_invoices pi
   SET due_date = NULL,
       updated_at = NOW()
 WHERE pi.due_date IS NOT NULL
   AND pi.invoice_date IS NOT NULL
   AND pi.due_date = (pi.invoice_date + INTERVAL '10 days')::date
   AND NOT EXISTS (
     SELECT 1
       FROM doc_email_intake dei
      WHERE dei.invoice_number = pi.invoice_number
        AND dei.parse_raw IS NOT NULL
        AND COALESCE(dei.parse_raw::jsonb ->> 'payment_due_at', '') <> ''
   );

-- 2. Реестр — то же самое: вычищаем срок, если он совпадает с +10 и в бумаге
--    срока не было (страховка на случай, если V413 успел записать).
UPDATE doc_registry d
   SET payment_due_at = NULL,
       updated_at = NOW()
 WHERE d.deleted_at IS NULL
   AND d.payment_due_at IS NOT NULL
   AND d.invoice_date IS NOT NULL
   AND d.payment_due_at = (d.invoice_date + INTERVAL '10 days')::date
   AND NOT EXISTS (
     SELECT 1
       FROM doc_email_intake dei
      WHERE dei.invoice_number = d.invoice_number
        AND dei.parse_raw IS NOT NULL
        AND COALESCE(dei.parse_raw::jsonb ->> 'payment_due_at', '') <> ''
   );

COMMIT;
