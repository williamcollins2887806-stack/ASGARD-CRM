-- V402 down: убрать индексы порядка списка.
DROP INDEX IF EXISTS idx_doc_registry_list_order;
DROP INDEX IF EXISTS idx_doc_registry_owner_order;
DROP INDEX IF EXISTS idx_doc_registry_pm_order;
