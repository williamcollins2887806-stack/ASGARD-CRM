-- V403 down: откат номенклатурных полей из счёта.
-- Не удаляем данные истории цен агрессивно: сначала снимаем индексы и FK,
-- затем колонки. Если нужно сохранить значения — сделайте дамп price_records
-- до применения этого файла.

ALTER TABLE price_records
  DROP CONSTRAINT IF EXISTS price_records_doc_registry_id_fkey;

DROP INDEX IF EXISTS idx_price_records_product_date;
DROP INDEX IF EXISTS idx_price_records_doc;
DROP INDEX IF EXISTS idx_price_records_supplier_date;

ALTER TABLE price_records
  DROP COLUMN IF EXISTS quantity,
  DROP COLUMN IF EXISTS total,
  DROP COLUMN IF EXISTS invoice_date,
  DROP COLUMN IF EXISTS invoice_number,
  DROP COLUMN IF EXISTS doc_registry_id,
  DROP COLUMN IF EXISTS doc_registry_item_id;
