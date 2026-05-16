-- ═══════════════════════════════════════════════════════════════════════════
-- V108 — Чертоги Мимира (Mimir's Halls) — Field Worker Academy
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Уроки (Руны) ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_lessons (
  id              SERIAL PRIMARY KEY,
  week_number     INTEGER NOT NULL,         -- Порядковый номер недели (уникальный)
  saga            TEXT NOT NULL,            -- Название саги (раздела)
  title           TEXT NOT NULL,            -- Название руны
  cover_icon      TEXT NOT NULL DEFAULT '📖', -- Emoji или SVG-ключ для обложки
  cover_color     TEXT NOT NULL DEFAULT '#1a1a2e', -- Цвет фона обложки
  blocks          JSONB NOT NULL DEFAULT '[]',  -- Контент-блоки урока
  estimated_minutes INTEGER NOT NULL DEFAULT 5, -- Расчётное время чтения
  tags            TEXT[] DEFAULT '{}',       -- Теги: safety, tool, health, law, etc.
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  generated_by    TEXT DEFAULT 'manual' CHECK (generated_by IN ('manual','mimir')),
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(week_number)
);

-- ─── Вопросы испытания ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_quiz_questions (
  id              SERIAL PRIMARY KEY,
  lesson_id       INTEGER NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  question_type   TEXT NOT NULL DEFAULT 'choice' CHECK (question_type IN (
    'choice',   -- Выбор из 4 вариантов
    'truefalse',-- Верно/Неверно
    'scenario', -- Разбор ситуации
    'order'     -- Расставь по порядку
  )),
  question_text   TEXT NOT NULL,
  options         JSONB NOT NULL DEFAULT '[]',  -- [{text, is_correct, explanation}]
  correct_explanation TEXT,   -- Объяснение правильного ответа
  image_url       TEXT        -- Фото-вопрос (URL)
);

-- ─── Прогресс рабочих ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_worker_progress (
  id              SERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  lesson_id       INTEGER NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  -- Чтение
  read_started_at TIMESTAMPTZ,
  read_completed_at TIMESTAMPTZ,      -- NULL = не дочитал
  read_time_seconds INTEGER DEFAULT 0, -- Реальное время чтения (scroll tracking)
  -- Испытание
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  score           INTEGER,            -- % правильных ответов в лучшей попытке
  passed          BOOLEAN NOT NULL DEFAULT FALSE,
  passed_at       TIMESTAMPTZ,
  blocked_until   TIMESTAMPTZ,        -- После 2 провалов — обязателен перечитай
  -- Итог
  runes_earned    INTEGER DEFAULT 0,
  xp_earned       INTEGER DEFAULT 0,
  UNIQUE(employee_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_academy_progress_employee ON academy_worker_progress(employee_id);
CREATE INDEX IF NOT EXISTS idx_academy_progress_lesson   ON academy_worker_progress(lesson_id);

-- ─── История попыток ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_quiz_attempts (
  id              SERIAL PRIMARY KEY,
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  lesson_id       INTEGER NOT NULL REFERENCES academy_lessons(id) ON DELETE CASCADE,
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  answers         JSONB NOT NULL DEFAULT '[]', -- [{question_id, selected_option, is_correct}]
  score           INTEGER NOT NULL,  -- % правильных
  passed          BOOLEAN NOT NULL DEFAULT FALSE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ
);

-- ─── Дневные факты ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_daily_facts (
  id              SERIAL PRIMARY KEY,
  fact_date       DATE NOT NULL UNIQUE,   -- На какой день
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  icon            TEXT NOT NULL DEFAULT '⚡',
  category        TEXT NOT NULL DEFAULT 'general' CHECK (category IN (
    'general','construction','history','health','tool','law','science','geography','viking'
  )),
  generated_by    TEXT DEFAULT 'mimir' CHECK (generated_by IN ('manual','mimir')),
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Просмотры фактов рабочими ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS academy_fact_views (
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  fact_id         INTEGER NOT NULL REFERENCES academy_daily_facts(id) ON DELETE CASCADE,
  viewed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (employee_id, fact_id)
);

-- ─── Changelog (баннер обновлений) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_updates (
  id              SERIAL PRIMARY KEY,
  version         TEXT NOT NULL UNIQUE,   -- Например '2.14.0'
  title           TEXT NOT NULL,          -- 'Чертоги Мимира открыты!'
  changes         JSONB NOT NULL DEFAULT '[]', -- [{icon, text}]
  target          TEXT NOT NULL DEFAULT 'both' CHECK (target IN ('desktop','mobile','field','both','all')),
  published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Последняя просмотренная версия changelog по каждому пользователю ───────
CREATE TABLE IF NOT EXISTS app_update_seen (
  user_id         INTEGER NOT NULL,       -- employees.id (field) или users.id (desktop)
  user_type       TEXT NOT NULL DEFAULT 'field' CHECK (user_type IN ('field','desktop')),
  last_seen_version TEXT NOT NULL,
  seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, user_type)
);

-- ─── Начальная запись версии для changelog ──────────────────────────────────
INSERT INTO app_updates (version, title, changes, target) VALUES (
  '3.0.0',
  'Чертоги Мимира открыты! ⚡',
  '[
    {"icon":"🏛️","text":"Запущена Академия «Чертоги Мимира» — еженедельные Руны знаний"},
    {"icon":"⚔️","text":"Проходи Испытания — зарабатывай Руны и XP"},
    {"icon":"📅","text":"Каждый день — новый интересный факт от Мимира"},
    {"icon":"🚫","text":"Не прошёл Испытание — нельзя выйти на смену"}
  ]'::jsonb,
  'field'
) ON CONFLICT (version) DO NOTHING;
