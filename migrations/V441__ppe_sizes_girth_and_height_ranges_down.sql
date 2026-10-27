-- V441 (rollback): вернуть числовой рост и прежние подписи колонок.
-- ВНИМАНИЕ: диапазон роста «170-176» не конвертируется обратно в число —
-- берём середину диапазона. Нечисловые значения становятся NULL.
BEGIN;

ALTER TABLE employees
  ALTER COLUMN height TYPE INTEGER
  USING (CASE
    WHEN height IS NULL THEN NULL
    WHEN height ~ '^\d+$' THEN height::integer
    WHEN height ~ '^\d+-\d+$' THEN
      ((split_part(height, '-', 1)::integer + split_part(height, '-', 2)::integer) / 2)
    ELSE NULL
  END);

COMMENT ON COLUMN employees.height IS NULL;
COMMENT ON COLUMN employees.clothing_size IS NULL;

COMMIT;
