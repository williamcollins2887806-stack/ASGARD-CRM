-- V403: номенклатура из счёта — чего не хватало для поиска «почём купили».
--
-- Дефект (проверка заказчика 17.10.2026): позиции счёта уходили в номенклатуру,
-- но БЕЗ количества, БЕЗ даты счёта и БЕЗ связи с самим документом реестра.
-- По такой записи нельзя ответить на вопрос «сколько и когда мы купили и по
-- какому счёту». Плюс нет даты прайса — нет истории цен по времени.
--
-- Добавляем к price_records:
--   quantity             — сколько единиц в позиции счёта;
--   invoice_date         — дата счёта (день закупки, для временных рядов цен);
--   doc_registry_id      — ссылка на документ реестра (источник позиции);
--   doc_registry_item_id — ссылка на строку документа (если разложена по позициям);
--   currency уже есть; добавляем total (сумма строки) для сверки.
--
-- Идентификаторы: idempotent (ADD COLUMN IF NOT EXISTS), безопасно на проде.

ALTER TABLE price_records
  ADD COLUMN IF NOT EXISTS quantity numeric(14,3),
  ADD COLUMN IF NOT EXISTS total numeric(16,2),
  ADD COLUMN IF NOT EXISTS invoice_date date,
  ADD COLUMN IF NOT EXISTS invoice_number varchar(64),
  ADD COLUMN IF NOT EXISTS doc_registry_id integer,
  ADD COLUMN IF NOT EXISTS doc_registry_item_id integer;

-- FK на документ (ON DELETE SET NULL — история цен не должна рушиться при удалении строки реестра).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'price_records_doc_registry_id_fkey'
  ) THEN
    ALTER TABLE price_records
      ADD CONSTRAINT price_records_doc_registry_id_fkey
      FOREIGN KEY (doc_registry_id) REFERENCES doc_registry(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Индексы: «почём покупали этот товар» (по продукту, свежие сверху) и «что дал этот счёт».
CREATE INDEX IF NOT EXISTS idx_price_records_product_date
  ON price_records (product_id, invoice_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_price_records_doc
  ON price_records (doc_registry_id) WHERE doc_registry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_price_records_supplier_date
  ON price_records (supplier_id, invoice_date DESC NULLS LAST);
