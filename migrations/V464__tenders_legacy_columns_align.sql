-- V464: выравнивание legacy-колонок tenders (на проде есть, в миграциях могли отсутствовать).

ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_number VARCHAR(255);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS deadline DATE;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS estimated_sum NUMERIC(15,2);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_region TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_contact TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_phone TEXT;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tender_email TEXT;

UPDATE tenders
   SET estimated_sum = tender_price
 WHERE estimated_sum IS NULL
   AND tender_price IS NOT NULL;

UPDATE tenders
   SET deadline = docs_deadline
 WHERE deadline IS NULL
   AND docs_deadline IS NOT NULL;
