-- ═══════════════════════════════════════════════════════════════════════════
-- V483: за чей счёт доставка + канал подписания акта сверки
-- ═══════════════════════════════════════════════════════════════════════════
-- ЗАЧЕМ. Заказчик 10.11.2026: «Нужно добавить в реестр счетов — за чей счёт
-- доставка. Включена в стоимость за наш счёт или за счёт поставщика. Иное.
-- И когда ИИ разбирает счёт: если в нём есть доставка — значит за наш счёт,
-- включена в стоимость; если доставки нет — нужно уточнять: за наш платим
-- отдельно или за счёт поставщика».
--
-- Что мешало:
--   1. Признака не было ни в `payment_invoices`, ни в `doc_registry` — бухгалтерия
--      узнавала про доставку из переписки, а директор согласовывал счёт
--      «вслепую»: непонятно, входит ли доставка в сумму или мы платим её ещё раз.
--   2. У актов сверки не было способа подписания (ЭДО / скан / оригинал).
--      Он есть у каждого счёта (`doc_registry.receive_channel`), но акт его
--      не наследовал — бухгалтерия спрашивала заново у каждого контрагента.
--   3. `doc_reconciliation_acts.comment` существовал, но перезаписывался пустой
--      строкой при каждом нажатии «Запросить/Получен» (см. фикс в роутере).
--
-- Значения `delivery_payer`:
--   included      — доставка входит в стоимость счёта, платим внутри суммы
--   ours_separate — за наш счёт, оплачиваем отдельно
--   supplier      — за счёт поставщика (в сумму счёта не входит и нам не счёт)
--   other         — иное (пояснение в `delivery_payer_note`)
--   none          — доставки нет / не применимо
--   NULL          — не установлено = «уточнить»
--
-- Идемпотентна: ADD COLUMN IF NOT EXISTS, CHECK через pg_constraint, бэкфилл
-- только по пустым значениям.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── 1. Заявка на оплату (счёт) ──────────────────────────────────────────
ALTER TABLE payment_invoices
  ADD COLUMN IF NOT EXISTS delivery_payer        varchar(20),
  ADD COLUMN IF NOT EXISTS delivery_payer_note   varchar(200),
  ADD COLUMN IF NOT EXISTS delivery_payer_source varchar(10);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_invoices_delivery_payer'
  ) THEN
    ALTER TABLE payment_invoices
      ADD CONSTRAINT chk_payment_invoices_delivery_payer
      CHECK (delivery_payer IS NULL OR delivery_payer IN
        ('included','ours_separate','supplier','other','none'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_payment_invoices_delivery_src'
  ) THEN
    ALTER TABLE payment_invoices
      ADD CONSTRAINT chk_payment_invoices_delivery_src
      CHECK (delivery_payer_source IS NULL OR delivery_payer_source IN ('ai','manual'));
  END IF;
END $$;

COMMENT ON COLUMN payment_invoices.delivery_payer IS
  'За чей счёт доставка: included (в цене) | ours_separate (наш отдельно) | '
  'supplier (поставщика) | other (иное, см. note) | none (нет доставки). '
  'NULL = не установлено, требует уточнения.';
COMMENT ON COLUMN payment_invoices.delivery_payer_note IS
  'Пояснение для delivery_payer=other. Для остальных значений пусто.';
COMMENT ON COLUMN payment_invoices.delivery_payer_source IS
  'Откуда значение: ai (распознано из счёта) | manual (выбрал человек). '
  'Нужен, чтобы повторное распознавание не затирало ручной выбор.';

-- ─── 2. Строка реестра (документ без заявки) ─────────────────────────────
ALTER TABLE doc_registry
  ADD COLUMN IF NOT EXISTS delivery_payer      varchar(20),
  ADD COLUMN IF NOT EXISTS delivery_payer_note varchar(200);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_doc_registry_delivery_payer'
  ) THEN
    ALTER TABLE doc_registry
      ADD CONSTRAINT chk_doc_registry_delivery_payer
      CHECK (delivery_payer IS NULL OR delivery_payer IN
        ('included','ours_separate','supplier','other','none'));
  END IF;
END $$;

COMMENT ON COLUMN doc_registry.delivery_payer IS
  'За чей счёт доставка (зеркало payment_invoices.delivery_payer для строк '
  'реестра без заявки на оплату). Плашка читает COALESCE(d, pi).';
COMMENT ON COLUMN doc_registry.delivery_payer_note IS
  'Пояснение для delivery_payer=other.';

-- ─── 3. Акт сверки: способ подписания ────────────────────────────────────
ALTER TABLE doc_reconciliation_acts
  ADD COLUMN IF NOT EXISTS receive_channel varchar(10) DEFAULT 'auto';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_doc_recon_acts_receive_channel'
  ) THEN
    ALTER TABLE doc_reconciliation_acts
      ADD CONSTRAINT chk_doc_recon_acts_receive_channel
      CHECK (receive_channel IS NULL OR receive_channel IN
        ('auto','edo','scan','original'));
  END IF;
END $$;

COMMENT ON COLUMN doc_reconciliation_acts.receive_channel IS
  'Способ подписания акта: auto (по большинству счетов контрагента за период: '
  '>50% ЭДО → ЭДО, иначе оригинал; нет данных → «канал не задан») | edo | scan | original. '
  'Не-auto = ручной выбор бухгалтерии, он побеждает автоопределение.';

-- ─── 4. Бэкфилл канала у уже существующих актов ──────────────────────────
-- Не угадываем: ставим 'auto', чтобы список сам посчитал по счетам периода.
UPDATE doc_reconciliation_acts
   SET receive_channel = 'auto'
 WHERE receive_channel IS NULL;

COMMIT;

-- ПРОВЕРКА:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name='payment_invoices'
--      AND column_name LIKE 'delivery_payer%';
--   -- ожидание: 3 строки (delivery_payer, delivery_payer_note, delivery_payer_source)
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='doc_registry' AND column_name LIKE 'delivery_payer%';
--   -- ожидание: 2 строки
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_name='doc_reconciliation_acts' AND column_name='receive_channel';
--   -- ожидание: 1 строка, default 'auto'

-- ОТКАТ: см. V483__delivery_payer_and_act_channel_down.sql
