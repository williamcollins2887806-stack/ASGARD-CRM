-- V473: письма для оплаты через ОБС — справочник ОБС-счетов и связь с перепиской.
--
-- ЗАЧЕМ. Письмо для ОБС уже генерировалось (V437 + obs-letter.js), но:
--   1) в письме не было ОБС-счёта — куда именно платить, знали только по памяти;
--   2) письмо НЕ попадало в корреспонденцию: 9 писем лежали отдельными строками
--      doc_registry, и в реестре переписки их не было. Исходящие номера
--      «терялись» — их нельзя было найти там, где их ищут.
--
-- ЧТО ДОБАВЛЯЕМ.
--   • `obs_accounts` — справочник ОБС-счетов (название, заказчик, банк, объект).
--   • `doc_registry.obs_account_id` — какой ОБС-счёт указан в письме по этому счёту.
--   • `correspondence.obs_account_id`, `correspondence.obs_invoice_doc_id` —
--     двусторонняя связь письма в переписке с ОБС-счётом и строкой реестра.
--   • новый вид письма `obs_payment` в CHECK `letter_kind` — чтобы в реестре
--     переписки был фильтр «Письма для оплаты через ОБС».
--
-- Идемпотентна: ADD COLUMN IF NOT EXISTS, INSERT ... WHERE NOT EXISTS,
-- CHECK пересоздаётся через DROP IF EXISTS + ADD.

BEGIN;

-- 1. Справочник ОБС-счетов.
CREATE TABLE IF NOT EXISTS obs_accounts (
  id                SERIAL PRIMARY KEY,
  name              TEXT NOT NULL,
  customer_name     TEXT,
  inn               TEXT,
  kpp               TEXT,
  bank_name         TEXT,
  bank_account      TEXT,
  bank_corr_account TEXT,
  bank_bik          TEXT,
  work_id           INTEGER REFERENCES works(id) ON DELETE SET NULL,
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  note              TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_obs_accounts_name
  ON obs_accounts (name)
  WHERE is_active;

COMMENT ON TABLE obs_accounts IS
  'Справочник ОБС-счетов: через какой счёт платится расход и по какому объекту. '
  'Реквизиты заполняет админ в карточке счёта (кнопка «+ ОБС»).';

-- Стартовая запись по объекту АГПЗ. Реквизиты НЕ выдумываем — их заполняет
-- админ в справочнике: пустое поле честнее неверного номера счёта.
INSERT INTO obs_accounts (name, customer_name, work_id, note)
SELECT 'ОБС «АГПЗ»',
       'ООО «ГСП Ремонт»',
       (SELECT id FROM works WHERE id = 417),
       'ОБС по объекту Астраханский ГПЗ. Банковские реквизиты заполняются в справочнике.'
WHERE NOT EXISTS (SELECT 1 FROM obs_accounts WHERE name = 'ОБС «АГПЗ»');

-- 2. Ссылка из строки реестра на ОБС-счёт.
ALTER TABLE doc_registry
  ADD COLUMN IF NOT EXISTS obs_account_id INTEGER REFERENCES obs_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_doc_registry_obs_account
  ON doc_registry (obs_account_id)
  WHERE deleted_at IS NULL AND obs_account_id IS NOT NULL;

COMMENT ON COLUMN doc_registry.obs_account_id IS
  'ОБС-счёт, через который платится этот счёт (справочник obs_accounts)';

-- 3. Связь письма в переписке с ОБС-счётом и строкой реестра.
ALTER TABLE correspondence
  ADD COLUMN IF NOT EXISTS obs_account_id INTEGER REFERENCES obs_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS obs_invoice_doc_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_correspondence_obs_invoice
  ON correspondence (obs_invoice_doc_id)
  WHERE deleted_at IS NULL AND obs_invoice_doc_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_correspondence_obs_account
  ON correspondence (obs_account_id)
  WHERE deleted_at IS NULL AND obs_account_id IS NOT NULL;

COMMENT ON COLUMN correspondence.obs_invoice_doc_id IS
  'Строка doc_registry (счёт), по которой создано письмо для оплаты через ОБС';
COMMENT ON COLUMN correspondence.obs_account_id IS
  'ОБС-счёт, указанный в письме (справочник obs_accounts)';

-- 4. Новый вид письма. CHECK пересоздаём: старый не пропускал obs_payment.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'correspondence_letter_kind_check'
  ) THEN
    ALTER TABLE correspondence DROP CONSTRAINT correspondence_letter_kind_check;
  END IF;

  ALTER TABLE correspondence
    ADD CONSTRAINT correspondence_letter_kind_check
    CHECK (letter_kind IN (
      'clarification','request','response','notification',
      'claim','warranty','cover','information','free','obs_payment'
    ));
END $$;

COMMIT;
