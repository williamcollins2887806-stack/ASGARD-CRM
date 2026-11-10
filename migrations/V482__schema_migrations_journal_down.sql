-- Откат V482: убрать алиас и доп. колонки журнала (сами записи migrations не трогаем)

BEGIN;

DROP VIEW IF EXISTS schema_migrations;

ALTER TABLE migrations DROP CONSTRAINT IF EXISTS migrations_source_check;

ALTER TABLE migrations
  DROP COLUMN IF EXISTS note,
  DROP COLUMN IF EXISTS source,
  DROP COLUMN IF EXISTS applied_by,
  DROP COLUMN IF EXISTS git_commit,
  DROP COLUMN IF EXISTS checksum;

COMMENT ON TABLE migrations IS NULL;

COMMIT;
