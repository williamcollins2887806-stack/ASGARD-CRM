-- Рунопровод — мини-игра для Field PWA
CREATE TABLE IF NOT EXISTS gamification_pipeline_stats (
  employee_id   INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  max_level     INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak   INTEGER NOT NULL DEFAULT 0,
  total_stars   INTEGER NOT NULL DEFAULT 0,
  weekly_stars  INTEGER NOT NULL DEFAULT 0,
  week_start    DATE,
  total_levels  INTEGER NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gamification_pipeline_daily (
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day_date        DATE NOT NULL DEFAULT (CURRENT_DATE AT TIME ZONE 'Europe/Moscow')::date,
  xp_earned       INTEGER NOT NULL DEFAULT 0,
  runes_earned    INTEGER NOT NULL DEFAULT 0,
  levels_cleared  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (employee_id, day_date)
);

CREATE TABLE IF NOT EXISTS gamification_pipeline_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  level_num     INTEGER NOT NULL,
  initial_grid  JSONB NOT NULL,
  move_limit    INTEGER NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours')
);

CREATE INDEX IF NOT EXISTS idx_pipeline_sessions_emp
  ON gamification_pipeline_sessions (employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pipeline_sessions_open
  ON gamification_pipeline_sessions (employee_id)
  WHERE completed_at IS NULL;
