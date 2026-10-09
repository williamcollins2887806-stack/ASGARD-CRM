-- V379 rollback
ALTER TABLE contracts DROP COLUMN IF EXISTS contact_email;
ALTER TABLE contracts DROP COLUMN IF EXISTS contact_phone;
ALTER TABLE contracts DROP COLUMN IF EXISTS contact_person;
