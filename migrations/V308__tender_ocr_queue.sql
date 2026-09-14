-- V308: Фоновая очередь OCR документов тендера
-- ──────────────────────────────────────────────────────────────────────────
-- Распаковка архивов → извлечение текста → кэш в documents.ocr_text.
-- Один тендер за раз, до 3 попыток, затем — следующий.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS parent_document_id INTEGER REFERENCES documents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_parent
  ON documents(parent_document_id)
  WHERE parent_document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_documents_tender_ocr
  ON documents(tender_id, ocr_status)
  WHERE tender_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tender_ocr_jobs (
  id              SERIAL PRIMARY KEY,
  tender_id       INTEGER NOT NULL UNIQUE REFERENCES tenders(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','failed','retry')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  max_attempts    INTEGER NOT NULL DEFAULT 3,
  last_error      TEXT,
  stats           JSONB NOT NULL DEFAULT '{}'::jsonb,
  requeue_after   BOOLEAN NOT NULL DEFAULT FALSE,
  scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tender_ocr_jobs_claim
  ON tender_ocr_jobs(scheduled_at ASC)
  WHERE status IN ('pending', 'retry');

COMMENT ON TABLE tender_ocr_jobs IS 'Очередь фонового OCR/распаковки документов тендера (1 тендер = 1 job).';
COMMENT ON COLUMN documents.parent_document_id IS 'Родительский архив, из которого извлечён файл.';
