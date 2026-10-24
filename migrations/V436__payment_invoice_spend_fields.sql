-- ═══════════════════════════════════════════════════════════════════════════
-- V436: D-368 — поля счёта, которые терялись до отправки директору
-- ═══════════════════════════════════════════════════════════════════════════
-- ДЕФЕКТ (найден 23.10.2026 при подготовке мобильной страницы «Мои заявки»).
--
-- В модалке согласования счетов (public/assets/js/procurement-batch.js) есть:
--   • чипы «Вид расхода»: работы / склад / офис / прочее  (:493-521);
--   • поля «Срок оплаты», «Срок ожидания СФ», «Услуга оказана»,
--     «Основание СФ» (:551-570).
--
-- НО:
--   1) `spend_kind` вообще отсутствовал в `draftPayload` (:1205-1227), то есть
--      до сервера не доезжал. Пользователь выбирал «Офис / АХО», а счёт уходил
--      без вида расхода — и в реестре попадал в «работы» по умолчанию.
--   2) `sf_due_at`, `service_done_at`, `sf_basis` тоже отсутствовали в payload.
--   3) колонок для них в `payment_invoices` не было вообще — только в
--      `doc_registry`, куда они попадали бы лишь после создания строки реестра.
--
-- Следствие на проде: у счетов, заведённых через модалку, вид расхода терялся.
-- Офисный счёт мог не попасть в реестр офисных расходов, а расход по объекту
-- создавался там, где его быть не должно.
--
-- Что делает миграция: добавляет 4 колонки в `payment_invoices`.
-- Идемпотентна (IF NOT EXISTS), безопасна для повтора.

BEGIN;

ALTER TABLE payment_invoices
  ADD COLUMN IF NOT EXISTS spend_kind     varchar(16),
  ADD COLUMN IF NOT EXISTS sf_due_at      date,
  ADD COLUMN IF NOT EXISTS service_done_at date,
  ADD COLUMN IF NOT EXISTS sf_basis       varchar(16),
  -- D-369: колонка нужна, потому что десктопный `draftPayload` шлёт comment_text
  -- ВСЕГДА (procurement-batch.js:1225), а PATCH собирает SET-выражения из списка
  -- FIELDS. Колонки в таблице не было → `column "comment_text" does not exist`
  -- → PATCH отдавал 503 на ЛЮБОМ счёте. То есть «Сохранить черновик» и
  -- «Отправить директору» на десктопе не работали вовсе (проверено на проде).
  -- D-369: ИНН контрагента из заявки. Нужен, потому что у 8 из 41 счёта есть
  -- только название, а supplier_id пуст — без ИНН бухгалтерия не получит
  -- реквизиты для платёжки. Раньше поле в мастере было, а сохранять его было
  -- некуда: сервер молча отбрасывал.
  ADD COLUMN IF NOT EXISTS counterparty_inn varchar(12),
  ADD COLUMN IF NOT EXISTS comment_text   text;

-- Допустимые значения вида расхода — те же, что в doc_registry.spend_kind.
-- Ставим CHECK только если его ещё нет (повторный запуск не упадёт).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_invoices_spend_kind'
  ) THEN
    ALTER TABLE payment_invoices
      ADD CONSTRAINT chk_payment_invoices_spend_kind
      CHECK (spend_kind IS NULL OR spend_kind IN ('work','warehouse','office','other'));
  END IF;
END $$;

-- Основание СФ: по счёту или по оказанию услуги (как в doc_registry.sf_basis).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_invoices_sf_basis'
  ) THEN
    ALTER TABLE payment_invoices
      ADD CONSTRAINT chk_payment_invoices_sf_basis
      CHECK (sf_basis IS NULL OR sf_basis IN ('invoice','service'));
  END IF;
END $$;

COMMIT;

-- ПРОВЕРКА:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='payment_invoices'
--      AND column_name IN ('spend_kind','sf_due_at','service_done_at','sf_basis');
--   -- ожидание: 4 строки

-- ОТКАТ (при необходимости):
--   ALTER TABLE payment_invoices
--     DROP CONSTRAINT IF EXISTS chk_payment_invoices_spend_kind,
--     DROP CONSTRAINT IF EXISTS chk_payment_invoices_sf_basis;
--   ALTER TABLE payment_invoices
--     DROP COLUMN IF EXISTS spend_kind,
--     DROP COLUMN IF EXISTS sf_due_at,
--     DROP COLUMN IF EXISTS service_done_at,
--     DROP COLUMN IF EXISTS sf_basis;
