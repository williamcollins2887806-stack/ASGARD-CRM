-- Откат V474
DROP INDEX IF EXISTS idx_documents_table_positions;

ALTER TABLE documents
  DROP COLUMN IF EXISTS table_source,
  DROP COLUMN IF EXISTS table_per_sheet,
  DROP COLUMN IF EXISTS table_positions;
