-- V179: Импорт документов (УПД/счёт/Excel/фото) В КАТАЛОГ (не в заявку).
-- Загрузил документ мимо СРМ → распарсили → предпросмотр/редактирование → позиции
-- попадают в products (расходники) / equipment (оборудование) + price_records (цены).

CREATE TABLE IF NOT EXISTS catalog_imports (
  id          SERIAL       PRIMARY KEY,
  file_path   TEXT,
  file_type   VARCHAR(10)  NOT NULL CHECK (file_type IN ('excel','pdf','image')),
  source_doc  VARCHAR(20)  DEFAULT 'other' CHECK (source_doc IN ('upd','invoice','quote','other')),
  status      VARCHAR(12)  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','applied','discarded')),
  parsed_json JSONB,                          -- распарсенные позиции для предпросмотра/редактирования
  supplier_id INTEGER      REFERENCES suppliers(id) ON DELETE SET NULL,
  supplier_name VARCHAR(500),
  applied_count INTEGER    DEFAULT 0,
  created_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  applied_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_catalog_imports_status ON catalog_imports(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_catalog_imports_by ON catalog_imports(created_by);
