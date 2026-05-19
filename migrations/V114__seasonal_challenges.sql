-- V114: Seasonal Challenges — time-limited events with FOMO mechanics

CREATE TABLE IF NOT EXISTS seasonal_challenges (
  id           SERIAL PRIMARY KEY,
  slug         VARCHAR(80) UNIQUE NOT NULL,
  season_name  VARCHAR(100) NOT NULL,          -- "Весна 2026"
  description  TEXT,
  icon         VARCHAR(20) DEFAULT '🏆',
  color        VARCHAR(20) DEFAULT '#ffd700',  -- accent hex
  starts_at    TIMESTAMPTZ NOT NULL,
  ends_at      TIMESTAMPTZ NOT NULL,
  reward_type  VARCHAR(30) NOT NULL DEFAULT 'points', -- points | badge | title | runes
  reward_value INTEGER NOT NULL DEFAULT 0,            -- points/runes amount
  reward_label VARCHAR(100),                          -- e.g. "Значок «Чемпион Весны»"
  reward_icon  VARCHAR(20) DEFAULT '🏅',
  is_active    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS seasonal_challenge_tasks (
  id            SERIAL PRIMARY KEY,
  challenge_id  INTEGER NOT NULL REFERENCES seasonal_challenges(id) ON DELETE CASCADE,
  slug          VARCHAR(80) NOT NULL,
  name          VARCHAR(100) NOT NULL,
  description   TEXT,
  icon          VARCHAR(20),
  action_type   VARCHAR(50) NOT NULL,  -- shifts | no_penalty | lesson_passed | roulette_spins | projects | checkin_early | streak_days
  target_value  INTEGER NOT NULL DEFAULT 1,
  sort_order    INTEGER DEFAULT 0,
  UNIQUE(challenge_id, slug)
);

CREATE TABLE IF NOT EXISTS seasonal_worker_progress (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL,
  challenge_id  INTEGER NOT NULL REFERENCES seasonal_challenges(id) ON DELETE CASCADE,
  task_slug     VARCHAR(80) NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  completed     BOOLEAN DEFAULT false,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(employee_id, challenge_id, task_slug)
);

CREATE TABLE IF NOT EXISTS seasonal_worker_completions (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL,
  challenge_id  INTEGER NOT NULL REFERENCES seasonal_challenges(id) ON DELETE CASCADE,
  completed_at  TIMESTAMPTZ DEFAULT NOW(),
  reward_granted BOOLEAN DEFAULT false,
  UNIQUE(employee_id, challenge_id)
);

CREATE INDEX IF NOT EXISTS idx_seasonal_progress_emp ON seasonal_worker_progress(employee_id, challenge_id);
CREATE INDEX IF NOT EXISTS idx_seasonal_completions_emp ON seasonal_worker_completions(employee_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- Seed: Весна 2026 (01.04.2026 – 30.06.2026)
-- Reward: 250 очков + значок "Чемпион Весны"
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO seasonal_challenges
  (slug, season_name, description, icon, color, starts_at, ends_at,
   reward_type, reward_value, reward_label, reward_icon)
VALUES (
  'spring_2026',
  'Весна 2026',
  'Докажи, что ты настоящий воин Асгарда этой весной. Выполни все испытания до конца сезона и получи уникальный значок.',
  '🌿',
  '#22c55e',
  '2026-04-01 00:00:00+03',
  '2026-06-30 23:59:59+03',
  'points',
  250,
  'Значок «Чемпион Весны 2026»',
  '🌿'
) ON CONFLICT (slug) DO NOTHING;

-- Tasks for Весна 2026
WITH ch AS (SELECT id FROM seasonal_challenges WHERE slug = 'spring_2026')
INSERT INTO seasonal_challenge_tasks (challenge_id, slug, name, description, icon, action_type, target_value, sort_order)
SELECT ch.id, t.slug, t.name, t.descr, t.icon, t.action, t.target, t.ord
FROM ch, (VALUES
  ('shifts_15',     'Ударный труд',         'Отработай 15 смен за сезон',                 '⚒️',  'shifts',         15, 1),
  ('no_penalty',    'Чистый щит',            'Ни одного штрафа за весь сезон',              '🛡️',  'no_penalty',      1, 2),
  ('lesson_passed', 'Испытание Мимира',      'Сдай все обязательные уроки академии',       '📖',  'lesson_passed',   3, 3),
  ('roulette_5',    'Удача Норн',            'Крутани Колесо Норн 5 раз',                  '🎡',  'roulette_spins',  5, 4),
  ('early_bird_3',  'Рассветный воин',       'Отметься на смену до 07:00 трижды',          '🌅',  'checkin_early',   3, 5)
) AS t(slug, name, descr, icon, action, target, ord)
ON CONFLICT (challenge_id, slug) DO NOTHING;

-- ──────────────────────────────────────────────────────────────────────────────
-- Seed: Лето 2026 (01.07.2026 – 30.09.2026)
-- ──────────────────────────────────────────────────────────────────────────────
INSERT INTO seasonal_challenges
  (slug, season_name, description, icon, color, starts_at, ends_at,
   reward_type, reward_value, reward_label, reward_icon)
VALUES (
  'summer_2026',
  'Лето 2026',
  'Горячий сезон — горячие испытания. Стань легендой лета Асгарда.',
  '☀️',
  '#f59e0b',
  '2026-07-01 00:00:00+03',
  '2026-09-30 23:59:59+03',
  'points',
  300,
  'Значок «Огонь Лета 2026»',
  '☀️'
) ON CONFLICT (slug) DO NOTHING;

WITH ch AS (SELECT id FROM seasonal_challenges WHERE slug = 'summer_2026')
INSERT INTO seasonal_challenge_tasks (challenge_id, slug, name, description, icon, action_type, target_value, sort_order)
SELECT ch.id, t.slug, t.name, t.descr, t.icon, t.action, t.target, t.ord
FROM ch, (VALUES
  ('shifts_20',     'Стальная хватка',   'Отработай 20 смен за сезон',            '⚒️',  'shifts',         20, 1),
  ('no_penalty',    'Незапятнанная честь','Ни одного штрафа за весь сезон',        '🛡️',  'no_penalty',      1, 2),
  ('lesson_passed', 'Свет знаний',       'Сдай все обязательные уроки академии',  '📖',  'lesson_passed',   4, 3),
  ('roulette_7',    'Семь судеб',        'Крутани Колесо Норн 7 раз',             '🎡',  'roulette_spins',  7, 4),
  ('streak_5',      'Неостановимый',     'Проработай 5 дней подряд',              '🔥',  'streak_days',     5, 5)
) AS t(slug, name, descr, icon, action, target, ord)
ON CONFLICT (challenge_id, slug) DO NOTHING;
