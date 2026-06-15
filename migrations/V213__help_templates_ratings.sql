-- V213: Templates + Ratings для «Помощь коллеги» (Phase 8).
-- См. также:
--   src/routes/tasks.js — /help/templates*, /:id/rate, /help/analytics, /help/ai-suggest
--   public/desktop-v2-src/src/pages/Help/ — UI

-- ─── help_templates ───
CREATE TABLE IF NOT EXISTS help_templates (
  id            SERIAL PRIMARY KEY,
  owner_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  is_global     BOOLEAN DEFAULT false,           -- ADMIN/DIRECTOR_GEN могут делать общими
  name          VARCHAR(120) NOT NULL,           -- «Попросить ТО смету посмотреть»
  emoji         VARCHAR(8),                       -- 🛠 / 💰 / ...
  default_assignee_role VARCHAR(30),              -- TO/PROC/... (опц.)
  default_assignee_id   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title_pattern TEXT,                             -- «Помогите посмотреть смету по {{work}}»
  description   TEXT,
  priority      VARCHAR(20) DEFAULT 'normal',
  deadline_hours INTEGER,                         -- через сколько часов авто-дедлайн (опц.)
  use_count     INTEGER DEFAULT 0,                -- для популярности
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_help_templates_owner  ON help_templates(owner_id) WHERE owner_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_help_templates_global ON help_templates(is_global) WHERE is_global = true;

-- ─── help_ratings ───
-- 1 оценка от creator → assignee на задачу (после complete).
CREATE TABLE IF NOT EXISTS help_ratings (
  id           SERIAL PRIMARY KEY,
  task_id      INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  rater_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rated_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stars        INTEGER NOT NULL CHECK (stars BETWEEN 1 AND 5),
  thanks_text  TEXT,
  created_at   TIMESTAMP DEFAULT NOW(),
  UNIQUE (task_id, rater_id)
);
CREATE INDEX IF NOT EXISTS idx_help_ratings_rated ON help_ratings(rated_id);
CREATE INDEX IF NOT EXISTS idx_help_ratings_task  ON help_ratings(task_id);

COMMENT ON TABLE help_templates IS '«Шаблоны помощи» — частые сценарии в 1 клик';
COMMENT ON TABLE help_ratings   IS 'Оценка качества помощи (1-5 звёзд + спасибо). 1 оценка на задачу от creator';
