-- V376 down: убрать гарантию одной линии и поля перехвата.
DROP INDEX IF EXISTS uniq_pbx_operators_single_on_line;
ALTER TABLE pbx_operators DROP COLUMN IF EXISTS on_line_since;
ALTER TABLE pbx_operators DROP COLUMN IF EXISTS on_line_by;
