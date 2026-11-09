-- V474: структурный счёт позиций документа
--
-- Зачем. Детектор недобора разбора ДВ должен знать, сколько позиций в
-- ведомости, чтобы отличить полный разбор от частичного. Считать по тексту
-- нельзя: 13 проходов верификатора показали, что любой текстовый счётчик
-- ломается на реальных форматах — единицы вынесены в шапку, нумерация
-- перезапускается в разделах, docx отдаёт ячейку отдельной строкой, csv —
-- запятые, и так далее.
--
-- Поэтому число позиций считается ОДИН РАЗ при извлечении текста, по сетке
-- ячеек (ExcelJS/SheetJS), и сохраняется здесь. Дальше анализ читает готовое
-- число — без повторных эвристик.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS table_positions integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS table_per_sheet jsonb,
  ADD COLUMN IF NOT EXISTS table_source text;

COMMENT ON COLUMN documents.table_positions IS
  'Число позиций таблицы, посчитанное по структуре файла (сетка ячеек). 0 = не посчитано.';
COMMENT ON COLUMN documents.table_per_sheet IS
  'Детализация по листам: [{"name": "...", "positions": N}].';
COMMENT ON COLUMN documents.table_source IS
  'Чем посчитано: grid (ExcelJS/SheetJS) или none.';

-- Индекс нужен анализу: он выбирает документы с найденными позициями.
CREATE INDEX IF NOT EXISTS idx_documents_table_positions
  ON documents (tender_id, table_positions)
  WHERE table_positions > 0;
