-- V241: Колонки manual_documents (JSONB) для works и tenders.
-- Используется генератором документов Мимир (src/services/document-generator.js)
-- для регистрации артефактов (смета.xlsx, отчёт.docx, письмо.docx).
-- Формат записей совпадает с pre_tender_requests.manual_documents:
--   [{ filename, original_name, mime_type, size, path, file_path, kind,
--      generated_at, generated_by }]

ALTER TABLE works    ADD COLUMN IF NOT EXISTS manual_documents JSONB;
ALTER TABLE tenders  ADD COLUMN IF NOT EXISTS manual_documents JSONB;

-- has_documents на works (как у pre_tender_requests) — упрощает фильтры в UI.
ALTER TABLE works    ADD COLUMN IF NOT EXISTS has_documents BOOLEAN DEFAULT false;
ALTER TABLE tenders  ADD COLUMN IF NOT EXISTS has_documents BOOLEAN DEFAULT false;
