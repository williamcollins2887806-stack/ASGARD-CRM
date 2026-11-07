-- V473 down: откат справочника ОБС-счетов и связи с перепиской.
--
-- ВНИМАНИЕ: откат удаляет ссылки на ОБС-счёт у счетов и писем. Сами письма
-- (doc_registry.package_type='letter' и correspondence) НЕ удаляются — они
-- остаются документами, теряется только привязка к справочнику.
--
-- Идемпотентен: DROP ... IF EXISTS.

BEGIN;

-- 4. Вид письма: возвращаем прежний whitelist без obs_payment.
--    Перед сменой CHECK переводим такие письма в свободный вид, иначе
--    ADD CONSTRAINT упадёт на существующих строках.
UPDATE correspondence
   SET letter_kind = 'free'
 WHERE letter_kind = 'obs_payment';

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
      'claim','warranty','cover','information','free'
    ));
END $$;

-- 3. Связь с ОБС-счётом в переписке.
DROP INDEX IF EXISTS idx_correspondence_obs_account;
DROP INDEX IF EXISTS idx_correspondence_obs_invoice;

ALTER TABLE correspondence
  DROP COLUMN IF EXISTS obs_invoice_doc_id,
  DROP COLUMN IF EXISTS obs_account_id;

-- 2. Ссылка из реестра.
DROP INDEX IF EXISTS idx_doc_registry_obs_account;

ALTER TABLE doc_registry
  DROP COLUMN IF EXISTS obs_account_id;

-- 1. Справочник.
DROP TABLE IF EXISTS obs_accounts;

COMMIT;
