-- V146: Office Academy v2 — retry-логика, история попыток, геймификация
-- Поднимаем офисную Академию до уровня Чертогов Мимира

-- ═══════════════════════════════════════════════════════════════
-- 1. Таблица истории попыток (аналог academy_quiz_attempts)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS office_academy_quiz_attempts (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
  lesson_id       INTEGER REFERENCES office_academy_lessons(id) ON DELETE CASCADE,
  attempt_number  INTEGER DEFAULT 1,
  answers         JSONB DEFAULT '[]',
  score           INTEGER NOT NULL,
  passed          BOOLEAN DEFAULT FALSE,
  started_at      TIMESTAMPTZ DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_oa_quiz_attempts_user
  ON office_academy_quiz_attempts(user_id, lesson_id);

-- ═══════════════════════════════════════════════════════════════
-- 2. Новые колонки в user_progress для retry + геймификации
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE office_academy_user_progress
  ADD COLUMN IF NOT EXISTS read_time_seconds INTEGER DEFAULT 0;

ALTER TABLE office_academy_user_progress
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

ALTER TABLE office_academy_user_progress
  ADD COLUMN IF NOT EXISTS xp_earned INTEGER DEFAULT 0;

ALTER TABLE office_academy_user_progress
  ADD COLUMN IF NOT EXISTS streak_months INTEGER DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════
-- 3. Индекс на quiz_questions (отсутствовал)
-- ═══════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_oa_quiz_questions_lesson
  ON office_academy_quiz_questions(lesson_id);

-- ═══════════════════════════════════════════════════════════════
-- 4. Снять UNIQUE(month_number, track) — позволяет >1 урока на трек/месяц
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE office_academy_lessons
  DROP CONSTRAINT IF EXISTS office_academy_lessons_month_number_track_key;

-- ═══════════════════════════════════════════════════════════════
-- 5. Удалить старые seed-черновики без контента (month_number=1, status=draft)
-- ═══════════════════════════════════════════════════════════════
DELETE FROM office_academy_lessons
  WHERE month_number = 1 AND status = 'draft'
    AND (blocks = '[]'::jsonb OR blocks IS NULL);
