-- V442 down: вернуть эксклюзивную линию (одна on_line=true).
--
-- ВНИМАНИЕ: если на момент отката линий больше одной, индекс не создастся.
-- Тогда лишние снимаются заранее, чтобы откат был детерминированным.

-- Оставляем только одного «на линии» (самого свежего), остальных снимаем —
-- иначе уникальный индекс не построится.
UPDATE pbx_operators
SET on_line = false, updated_at = NOW()
WHERE on_line = true
  AND user_id <> (
    SELECT user_id FROM pbx_operators
    WHERE on_line = true
    ORDER BY COALESCE(on_line_since, updated_at) DESC, user_id
    LIMIT 1
  );

DROP INDEX IF EXISTS idx_pbx_operators_on_line_active;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pbx_operators_single_on_line
  ON pbx_operators ((true))
  WHERE on_line = true;

ALTER TABLE pbx_operators DROP COLUMN IF EXISTS calls_taken;
