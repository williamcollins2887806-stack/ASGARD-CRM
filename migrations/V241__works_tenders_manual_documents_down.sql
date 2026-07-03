-- V241 DOWN: убрать manual_documents/has_documents с works/tenders.

ALTER TABLE works    DROP COLUMN IF EXISTS manual_documents;
ALTER TABLE works    DROP COLUMN IF EXISTS has_documents;
ALTER TABLE tenders  DROP COLUMN IF EXISTS manual_documents;
ALTER TABLE tenders  DROP COLUMN IF EXISTS has_documents;
