-- V217 DOWN: откат расширения employees.
-- Используется только в asgard_crm_test для тестов (не на проде).

ALTER TABLE employees
  DROP COLUMN IF EXISTS phone2,
  DROP COLUMN IF EXISTS telegram,
  DROP COLUMN IF EXISTS spouse_name,
  DROP COLUMN IF EXISTS spouse_phone,
  DROP COLUMN IF EXISTS relative_name,
  DROP COLUMN IF EXISTS relative_relation,
  DROP COLUMN IF EXISTS relative_phone,
  DROP COLUMN IF EXISTS education,
  DROP COLUMN IF EXISTS specialty,
  DROP COLUMN IF EXISTS marital_status,
  DROP COLUMN IF EXISTS children_count,
  DROP COLUMN IF EXISTS shoe_size,
  DROP COLUMN IF EXISTS height,
  DROP COLUMN IF EXISTS blood_type,
  DROP COLUMN IF EXISTS medical_notes;
