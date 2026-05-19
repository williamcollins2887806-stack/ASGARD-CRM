-- V116: Office Corporate Academy — monthly role-specific training for office staff

CREATE TABLE IF NOT EXISTS office_academy_lessons (
  id               SERIAL PRIMARY KEY,
  month_number     INTEGER NOT NULL,            -- Порядковый номер месяца (глобальный)
  track            VARCHAR(30) NOT NULL DEFAULT 'all',  -- all | pm | hr | finance | procurement | management
  title            TEXT NOT NULL,
  saga             TEXT,                         -- Раздел/серия
  cover_icon       TEXT NOT NULL DEFAULT '🏛️',
  cover_color      TEXT NOT NULL DEFAULT '#1e1e3a',
  blocks           JSONB NOT NULL DEFAULT '[]',
  estimated_minutes INTEGER DEFAULT 20,
  tags             TEXT[] DEFAULT '{}',
  is_mandatory     BOOLEAN DEFAULT true,
  status           TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  generated_by     TEXT DEFAULT 'mimir' CHECK (generated_by IN ('manual','mimir')),
  published_at     TIMESTAMPTZ,
  release_date     DATE,                         -- Когда доступен
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(month_number, track)
);

CREATE TABLE IF NOT EXISTS office_academy_quiz_questions (
  id              SERIAL PRIMARY KEY,
  lesson_id       INTEGER NOT NULL REFERENCES office_academy_lessons(id) ON DELETE CASCADE,
  sort_order      INTEGER DEFAULT 0,
  question_type   TEXT DEFAULT 'choice' CHECK (question_type IN ('choice','truefalse','scenario')),
  question_text   TEXT NOT NULL,
  options         JSONB NOT NULL DEFAULT '[]',
  correct_explanation TEXT,
  image_url       TEXT
);

CREATE TABLE IF NOT EXISTS office_academy_user_progress (
  id                  SERIAL PRIMARY KEY,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  lesson_id           INTEGER NOT NULL REFERENCES office_academy_lessons(id) ON DELETE CASCADE,
  read_started_at     TIMESTAMPTZ,
  read_completed_at   TIMESTAMPTZ,
  passed              BOOLEAN DEFAULT false,
  score               INTEGER DEFAULT 0,
  attempts            INTEGER DEFAULT 0,
  passed_at           TIMESTAMPTZ,
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_office_lesson_track ON office_academy_lessons(track, status, release_date);
CREATE INDEX IF NOT EXISTS idx_office_progress_user ON office_academy_user_progress(user_id);

-- ── Seed: current month (month_number=1) — one lesson per track ──────────────
-- These are drafts that Mimir will fill; just establish the structure.
INSERT INTO office_academy_lessons (month_number, track, title, saga, cover_icon, cover_color, is_mandatory, status, release_date)
VALUES
  (1, 'pm',          'Управление проектами: основы контроля', 'Искусство руководства', '⚙️', '#1e2840', true, 'draft', DATE_TRUNC('month', NOW())::date),
  (1, 'hr',          'Трудовые отношения: договоры и кадровый учёт', 'Кадровое дело',  '👥', '#1e3830', true, 'draft', DATE_TRUNC('month', NOW())::date),
  (1, 'finance',     'Основы управленческого учёта', 'Финансовый щит',               '💰', '#1e2e18', true, 'draft', DATE_TRUNC('month', NOW())::date),
  (1, 'procurement', 'Закупки: процедуры и риски', 'Арсенал поставок',               '📦', '#2e1e18', true, 'draft', DATE_TRUNC('month', NOW())::date),
  (1, 'management',  'Корпоративная культура Асгарда', 'Путь лидера',                '🏛️', '#1a1830', true, 'draft', DATE_TRUNC('month', NOW())::date),
  (1, 'all',         'Информационная безопасность в компании', 'Цифровая броня',      '🔒', '#18202e', true, 'draft', DATE_TRUNC('month', NOW())::date)
ON CONFLICT (month_number, track) DO NOTHING;
