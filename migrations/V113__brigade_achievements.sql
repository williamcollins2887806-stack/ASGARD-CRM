-- V113: Brigade achievements — earned by entire work crew together

-- Add brigade achievement entries to the catalog
INSERT INTO worker_achievements (id, category, tier, points, name, description, icon, sort_order, is_secret, is_active)
VALUES
  ('brigade_first_blood',  'brigade', 'cup',    15, 'Первая кровь',      'Вся бригада завершила первую смену на объекте',            '🛡️', 200, false, true),
  ('brigade_iron_pact',    'brigade', 'medal',  40, 'Железный пакт',     'Вся бригада прошла обязательный урок академии',            '📖', 201, false, true),
  ('brigade_no_weakness',  'brigade', 'medal',  50, 'Нет слабых звеньев','Вся бригада 14 дней без штрафов на одном объекте',         '⚔️', 202, false, true),
  ('brigade_century',      'brigade', 'order',  75, 'Сотня',             'Бригада суммарно отработала 100 смен',                     '💯', 203, false, true),
  ('brigade_war_machine',  'brigade', 'order',  75, 'Военная машина',    'Бригада суммарно отработала 300 смен',                     '⚙️', 204, false, true),
  ('brigade_gold_rush',    'brigade', 'order',  60, 'Золотая лихорадка', 'Бригада суммарно заработала 500 000 ₽',                    '💰', 205, false, true),
  ('brigade_legends',      'brigade', 'legend', 100,'Легенды Асгарда',   'Бригада суммарно отработала 1000 смен',                    '🏛️', 206, false, true),
  ('brigade_all_masters',  'brigade', 'medal',  45, 'Все мастера',       'Каждый в бригаде имеет хотя бы 1 подвиг категории Мастерство', '🎓', 207, false, true)
ON CONFLICT (id) DO NOTHING;

-- Track which works have which brigade achievements (dedup)
CREATE TABLE IF NOT EXISTS brigade_achievement_log (
  id          SERIAL PRIMARY KEY,
  work_id     INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  achievement_id VARCHAR(100) NOT NULL,
  earned_at   TIMESTAMPTZ DEFAULT NOW(),
  member_count INTEGER,
  UNIQUE(work_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS idx_brigade_ach_work ON brigade_achievement_log(work_id);
