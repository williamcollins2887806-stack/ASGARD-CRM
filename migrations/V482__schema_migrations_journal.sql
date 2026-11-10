-- V482: усиление журнала миграций + алиас schema_migrations
--
-- История. В проекте давно есть таблица `migrations` (пишет migrations/run.js),
-- но она дырявая: часть V* накатывалась руками/scp без INSERT, а агенты искали
-- несуществующие `schema_migrations` / `flyway_schema_history` и отвечали
-- догадками по колонкам. Этот файл делает журнал однозначным:
--   1) расширяет `migrations` метаданными (checksum, git_commit, source);
--   2) даёт VIEW `schema_migrations` как алиас для поиска;
--   3) фиксирует правило в COMMENT — канон = таблица `migrations`.

BEGIN;

CREATE TABLE IF NOT EXISTS migrations (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  executed_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE migrations
  ADD COLUMN IF NOT EXISTS checksum   VARCHAR(64),
  ADD COLUMN IF NOT EXISTS git_commit VARCHAR(40),
  ADD COLUMN IF NOT EXISTS applied_by TEXT DEFAULT CURRENT_USER,
  ADD COLUMN IF NOT EXISTS source     TEXT DEFAULT 'runner',
  ADD COLUMN IF NOT EXISTS note       TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'migrations_source_check'
       AND conrelid = 'public.migrations'::regclass
  ) THEN
    ALTER TABLE migrations
      ADD CONSTRAINT migrations_source_check
      CHECK (source IS NULL OR source IN ('runner','targeted','manual','backfill','seed'));
  END IF;
END $$;

CREATE OR REPLACE VIEW schema_migrations AS
SELECT
  name        AS version,
  name        AS filename,
  executed_at AS applied_at,
  checksum,
  git_commit,
  applied_by,
  source,
  note,
  id
FROM migrations;

COMMENT ON TABLE migrations IS
  'Канонический журнал применённых SQL-миграций (VNNN__name). '
  'Вопрос «применена ли VNNN?» = SELECT 1 FROM migrations WHERE name LIKE ''VNNN__%''. '
  'Не путать с git-коммитами: коммиты хранит git, схему — эта таблица.';

COMMENT ON VIEW schema_migrations IS
  'Алиас журнала migrations для скриптов/агентов, которые ищут schema_migrations. '
  'Источник истины — таблица public.migrations.';

COMMENT ON COLUMN migrations.source IS
  'Как попала запись: runner | targeted | manual | backfill | seed';

COMMENT ON COLUMN migrations.checksum IS
  'SHA-256 содержимого .sql на момент применения (нижний регистр hex)';

COMMENT ON COLUMN migrations.git_commit IS
  'HEAD репозитория на машине, где применили миграцию (если доступен git)';

COMMIT;
