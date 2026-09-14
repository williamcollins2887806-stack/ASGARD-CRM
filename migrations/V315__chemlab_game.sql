-- Химцех — мини-игра перелива реагентов для Field PWA
CREATE TABLE IF NOT EXISTS gamification_chemlab_stats (
  employee_id    INTEGER PRIMARY KEY REFERENCES employees(id) ON DELETE CASCADE,
  max_level      INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak    INTEGER NOT NULL DEFAULT 0,
  total_stars    INTEGER NOT NULL DEFAULT 0,
  weekly_stars   INTEGER NOT NULL DEFAULT 0,
  week_start     DATE,
  total_levels   INTEGER NOT NULL DEFAULT 0,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS gamification_chemlab_daily (
  employee_id     INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  day_date        DATE NOT NULL DEFAULT (CURRENT_DATE AT TIME ZONE 'Europe/Moscow')::date,
  xp_earned       INTEGER NOT NULL DEFAULT 0,
  runes_earned    INTEGER NOT NULL DEFAULT 0,
  levels_cleared  INTEGER NOT NULL DEFAULT 0,
  bonus_5_claimed BOOLEAN NOT NULL DEFAULT false,
  bonus_10_claimed BOOLEAN NOT NULL DEFAULT false,
  PRIMARY KEY (employee_id, day_date)
);

CREATE TABLE IF NOT EXISTS gamification_chemlab_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id   INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  level_num     INTEGER NOT NULL,
  initial_cans  JSONB NOT NULL,
  goal          JSONB NOT NULL DEFAULT '{"type":"sort"}'::jsonb,
  move_limit    INTEGER NOT NULL,
  min_moves     INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '2 hours')
);

CREATE INDEX IF NOT EXISTS idx_chemlab_sessions_emp
  ON gamification_chemlab_sessions (employee_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chemlab_sessions_open
  ON gamification_chemlab_sessions (employee_id)
  WHERE completed_at IS NULL;

-- Квесты Химцеха
INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles, is_active)
SELECT 'daily', 'Смена в химцехе', 'Пройди 3 уровня в Химцехе', 'chemlab_level', 3, 'runes', 15, '🧪',
  'Три наряда без аварии — и Мимир зачтёт твою аккуратность.', 'worker', true
WHERE NOT EXISTS (SELECT 1 FROM gamification_quests WHERE target_action = 'chemlab_level' AND quest_type = 'daily');

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles, is_active)
SELECT 'weekly', 'Протокол на 3★', 'Пройди 5 уровней Химцеха на 3 звезды', 'chemlab_perfect', 5, 'runes', 40, '⭐',
  'Идеальный перелив без лишних движений — знак химика объекта.', 'worker', true
WHERE NOT EXISTS (SELECT 1 FROM gamification_quests WHERE target_action = 'chemlab_perfect' AND quest_type = 'weekly');

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles, is_active)
SELECT 'weekly', 'Серия химцеха', 'Достигни серии из 5 уровней подряд в Химцехе', 'chemlab_streak', 1, 'runes', 25, '🔥',
  'Пять нарядов подряд — смена, достойная Вальхаллы.', 'worker', true
WHERE NOT EXISTS (SELECT 1 FROM gamification_quests WHERE target_action = 'chemlab_streak' AND quest_type = 'weekly');
