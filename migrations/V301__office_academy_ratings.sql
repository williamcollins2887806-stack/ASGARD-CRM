-- V301: Office Academy — рейтинг интереса 1–5 + флаг перевыпуска
BEGIN;

ALTER TABLE office_academy_lessons
  ADD COLUMN IF NOT EXISTS interest_avg NUMERIC(3,2) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS interest_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS needs_rewrite BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rewritten_from_id INTEGER REFERENCES office_academy_lessons(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS office_academy_lesson_ratings (
  id          SERIAL PRIMARY KEY,
  lesson_id   INTEGER NOT NULL REFERENCES office_academy_lessons(id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  score       SMALLINT NOT NULL CHECK (score BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (lesson_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_oa_ratings_lesson ON office_academy_lesson_ratings(lesson_id);
CREATE INDEX IF NOT EXISTS idx_oa_lessons_needs_rewrite
  ON office_academy_lessons(needs_rewrite) WHERE needs_rewrite = true;

COMMIT;
