-- V409 (down): откат полей ИИ-извлечения продавца/получателя платежа.
DROP INDEX IF EXISTS idx_doc_registry_parse_engine;
DROP INDEX IF EXISTS idx_doc_registry_seller_inn;

ALTER TABLE doc_registry
  DROP COLUMN IF EXISTS parse_warnings,
  DROP COLUMN IF EXISTS parse_engine,
  DROP COLUMN IF EXISTS payee_kpp,
  DROP COLUMN IF EXISTS payee_inn,
  DROP COLUMN IF EXISTS payee_name,
  DROP COLUMN IF EXISTS seller_inn,
  DROP COLUMN IF EXISTS seller_name;
