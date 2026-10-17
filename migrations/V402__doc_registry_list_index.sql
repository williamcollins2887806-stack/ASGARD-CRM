-- ============================================================================
-- V402: индекс под основной порядок списка реестра.
-- ----------------------------------------------------------------------------
-- EXPLAIN на клоне показал Seq Scan + Sort на каждом запросе списка. При 1.6k
-- строк это 1 мс, но при росте до десятков тысяч — линейный рост. Индекс по
-- (invoice_date DESC, id DESC) с WHERE deleted_at IS NULL убирает сортировку.
-- Идемпотентно. Down — V402__..._down.sql.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_doc_registry_list_order
  ON doc_registry (invoice_date DESC NULLS LAST, id DESC)
  WHERE deleted_at IS NULL;

-- Для фильтра «мои строки» (scope=mine) — по владельцу + порядок.
CREATE INDEX IF NOT EXISTS idx_doc_registry_owner_order
  ON doc_registry (doc_owner_id, invoice_date DESC NULLS LAST)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_doc_registry_pm_order
  ON doc_registry (pm_id, invoice_date DESC NULLS LAST)
  WHERE deleted_at IS NULL;

COMMENT ON INDEX idx_doc_registry_list_order IS
  'V402: покрывает ORDER BY invoice_date DESC, id DESC для списка реестра.';
