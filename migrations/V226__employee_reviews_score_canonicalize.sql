-- D-003 (batch-B): канонизировать колонку score в employee_reviews.
-- На проде уже добавлена ALTER'ом без миграции; здесь делаем idempotent для свежей установки.
ALTER TABLE employee_reviews
  ADD COLUMN IF NOT EXISTS score INTEGER,
  ADD COLUMN IF NOT EXISTS work_id INTEGER,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW();

-- Чтобы старая колонка score_1_10 не блокировала фикс backend SQL (на проде её нет, но
-- если кто-то применил V001 чисто — backfill score из score_1_10).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name='employee_reviews' AND column_name='score_1_10') THEN
    UPDATE employee_reviews SET score = COALESCE(score, score_1_10) WHERE score IS NULL AND score_1_10 IS NOT NULL;
  END IF;
END $$;
