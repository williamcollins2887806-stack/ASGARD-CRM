-- Рунопровод v2: бонусы за день + квесты
ALTER TABLE gamification_pipeline_daily
  ADD COLUMN IF NOT EXISTS bonus_5_claimed  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bonus_10_claimed BOOLEAN NOT NULL DEFAULT false;

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles, is_active)
SELECT 'daily', 'Поток дня', 'Пройди 3 уровня в Рунопроводе', 'pipeline_level', 3, 'runes', 15, '🌊',
  'Три раза восстанови поток — и Мимиr одобрит твою сноровку.', 'worker', true
WHERE NOT EXISTS (SELECT 1 FROM gamification_quests WHERE target_action = 'pipeline_level' AND quest_type = 'daily');

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles, is_active)
SELECT 'weekly', 'Мастер труб', 'Пройди 5 уровней Рунопровода на 3 звезды', 'pipeline_perfect', 5, 'runes', 40, '⭐',
  'Идеальный поток без лишних поворотов — знак настоящего гидромеханика.', 'worker', true
WHERE NOT EXISTS (SELECT 1 FROM gamification_quests WHERE target_action = 'pipeline_perfect' AND quest_type = 'weekly');

INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon, lore, allowed_roles, is_active)
SELECT 'weekly', 'Серия воина', 'Достигни серии из 5 уровней подряд в Рунопроводе', 'pipeline_streak', 1, 'runes', 25, '🔥',
  'Пять уровней без остановки — путь достойный Вальхаллы.', 'worker', true
WHERE NOT EXISTS (SELECT 1 FROM gamification_quests WHERE target_action = 'pipeline_streak' AND quest_type = 'weekly');
