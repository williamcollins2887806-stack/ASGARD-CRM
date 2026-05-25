-- V124: Кэш OCR для документов
-- ──────────────────────────────────────────────────────────────────────────────
-- Раньше Мимир пытался отправить PDF как file block в Claude через routerai,
-- но routerai возвращал 503 Internal Server Error на этих запросах. В итоге
-- Claude не видел документ и угадывал контекст из customer_name.
--
-- Теперь: на сервере конвертим PDF → PNG (pdftoppm) → OCR через
-- google/gemini-2.5-flash (routerai) → вставляем извлечённый текст в
-- user-message Claude. Кэшируем чтобы не OCR-ить тот же PDF дважды.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS ocr_text TEXT,
  ADD COLUMN IF NOT EXISTS ocr_status TEXT CHECK (ocr_status IN ('pending','processing','done','failed','skipped')),
  ADD COLUMN IF NOT EXISTS ocr_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ocr_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ocr_pages_count INTEGER,
  ADD COLUMN IF NOT EXISTS ocr_model TEXT,
  ADD COLUMN IF NOT EXISTS ocr_error TEXT;

-- Индекс для быстрого поиска "что OCR-ить" — все документы без статуса либо failed
CREATE INDEX IF NOT EXISTS idx_documents_ocr_pending
  ON documents(id)
  WHERE ocr_status IS NULL OR ocr_status = 'failed';

COMMENT ON COLUMN documents.ocr_text IS 'Извлечённый текст из PDF/изображения через OCR (gemini-2.5-flash). NULL = не OCR-ено.';
COMMENT ON COLUMN documents.ocr_status IS 'Статус OCR: pending/processing/done/failed/skipped (не PDF).';
