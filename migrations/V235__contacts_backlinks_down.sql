-- V235 DOWN: откат контактных полей и обратных ссылок

DROP INDEX IF EXISTS idx_tenders_source_pretender;
DROP INDEX IF EXISTS idx_works_source_pretender;
DROP INDEX IF EXISTS idx_tenders_source_inbox;

ALTER TABLE works
  DROP COLUMN IF EXISTS source_inbox_application_id,
  DROP COLUMN IF EXISTS source_pre_tender_id,
  DROP COLUMN IF EXISTS customer_email,
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS contact_person,
  DROP COLUMN IF EXISTS customer_inn;

ALTER TABLE tenders
  DROP COLUMN IF EXISTS source_pre_tender_id,
  DROP COLUMN IF EXISTS source_inbox_application_id,
  DROP COLUMN IF EXISTS customer_address,
  DROP COLUMN IF EXISTS customer_city,
  DROP COLUMN IF EXISTS customer_email,
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS contact_person;

ALTER TABLE inbox_applications
  DROP COLUMN IF EXISTS customer_address,
  DROP COLUMN IF EXISTS customer_city,
  DROP COLUMN IF EXISTS customer_email,
  DROP COLUMN IF EXISTS contact_phone,
  DROP COLUMN IF EXISTS contact_person,
  DROP COLUMN IF EXISTS customer_name,
  DROP COLUMN IF EXISTS customer_inn;
