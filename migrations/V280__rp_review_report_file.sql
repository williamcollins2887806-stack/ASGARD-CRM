-- Прикреплённый файл отчёта (docx/pdf) к отчёту РП
ALTER TABLE tender_rp_reviews
  ADD COLUMN IF NOT EXISTS report_file_id INTEGER;

COMMENT ON COLUMN tender_rp_reviews.report_file_id IS 'Прикреплённый файл отчёта (docx/pdf)';
