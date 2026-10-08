-- V376: одна линия — не более одного on_line=true (исключительное владение).
-- Плюс поля для перехвата линии и голосовой почты.

-- Partial unique index: гонка двух «Встать на линию» больше не оставит двух дежурных.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_pbx_operators_single_on_line
  ON pbx_operators ((true))
  WHERE on_line = true;

-- Кто и когда забрал линию (для аудита и уведомления прежнего владельца).
ALTER TABLE pbx_operators ADD COLUMN IF NOT EXISTS on_line_since TIMESTAMPTZ;
ALTER TABLE pbx_operators ADD COLUMN IF NOT EXISTS on_line_by INTEGER REFERENCES users(id);

COMMENT ON COLUMN pbx_operators.on_line_since IS 'Когда оператор встал на линию (для перехвата/аудита).';
COMMENT ON COLUMN pbx_operators.on_line_by IS 'Кто поставил on_line=true (обычно сам оператор).';
