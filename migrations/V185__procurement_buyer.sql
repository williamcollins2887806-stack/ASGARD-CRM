-- V185: Рабочее место закупщика — сплит позиций между поставщиками + загрузка/трассировка счетов.
-- procurement_items: +parent_item_id (сплит на дочерние строки), +supplier_delivery_days (срок по
-- позиции/поставщику), +invoice_import_id (из какой загрузки счёта пришла цена).
-- procurement_invoice_imports: лог загруженных счетов (файл, поставщик, что сматчилось) — для
-- бухгалтера (видит счета при оплате) и отмены.

CREATE TABLE IF NOT EXISTS procurement_invoice_imports (
  id             SERIAL       PRIMARY KEY,
  procurement_id INTEGER      NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
  supplier_id    INTEGER      REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name  VARCHAR(500),
  delivery_days  INTEGER,
  file_path      TEXT,                         -- /uploads/... ссылка на файл счёта
  file_name      VARCHAR(500),
  parsed_json    JSONB,                        -- распознанные строки счёта
  total_sum      NUMERIC(14,2),                -- сумма счёта (по сматченным позициям)
  matched_count  INTEGER      DEFAULT 0,
  created_by     INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pii_proc ON procurement_invoice_imports(procurement_id);

ALTER TABLE procurement_items
  ADD COLUMN IF NOT EXISTS parent_item_id        INTEGER REFERENCES procurement_items(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS supplier_delivery_days INTEGER,
  ADD COLUMN IF NOT EXISTS invoice_import_id     INTEGER REFERENCES procurement_invoice_imports(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pi_parent ON procurement_items(parent_item_id) WHERE parent_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pi_invimp ON procurement_items(invoice_import_id) WHERE invoice_import_id IS NOT NULL;

-- pg_trgm для fuzzy-матчинга строк счёта к позициям заявки (если ещё не включён)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_pi_name_trgm ON procurement_items USING gin (lower(name) gin_trgm_ops);
