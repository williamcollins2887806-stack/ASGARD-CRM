-- Дата понедельника, с которого урок становится обязательным для смен
ALTER TABLE academy_lessons
  ADD COLUMN IF NOT EXISTS release_monday DATE;

CREATE INDEX IF NOT EXISTS idx_academy_lessons_release_monday
  ON academy_lessons(release_monday) WHERE status = 'published';
