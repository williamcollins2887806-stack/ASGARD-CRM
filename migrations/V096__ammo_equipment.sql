-- V096: Ammo / Equipment slots for avatars
-- Шлем, оружие, броня — доступны в магазине (руны) и рулетке

-- 1. New equipment columns on employees
ALTER TABLE employees ADD COLUMN IF NOT EXISTS active_helmet VARCHAR(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS active_weapon VARCHAR(100);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS active_armor  VARCHAR(100);

-- 2. Extend prize_type CHECK (add shop_item, cosmetic_item if missing)
ALTER TABLE gamification_prizes DROP CONSTRAINT IF EXISTS gamification_prizes_prize_type_check;
ALTER TABLE gamification_prizes ADD CONSTRAINT gamification_prizes_prize_type_check
  CHECK (prize_type IN (
    'runes','xp','multiplier','extra_spin','sticker',
    'avatar_frame','vip','merch','shop_item','cosmetic_item'
  ));

-- 3. Ensure unique index on shop items name (idempotent)
CREATE UNIQUE INDEX IF NOT EXISTS idx_gsi_name ON gamification_shop_items(name);

-- New cosmetic shop items — ammo
INSERT INTO gamification_shop_items (name, description, price_runes, category, icon, requires_delivery) VALUES
-- Шлемы
('Шлем "Рогатый"',       'Классический рогатый шлем викинга',    300, 'cosmetic', '⛑',  false),
('Шлем "Стальной"',      'Закалённый в битвах железный шлем',    200, 'cosmetic', '🪖',  false),
('Шлем "Ярла"',          'Позолоченный шлем военного вождя',     600, 'cosmetic', '👑',  false),
('Шлем "Берсерка"',      'Медвежья маска берсерка',              450, 'cosmetic', '🐻',  false),
-- Оружие
('Оружие "Боевой топор"','Двуручный топор воина Асгарда',        250, 'cosmetic', '🪓',  false),
('Оружие "Молот Тора"',  'Легендарный Мьёльнир Тора',           500, 'cosmetic', '🔨',  false),
('Оружие "Копьё Одина"', 'Гунгнир — копьё самого Всеотца',      800, 'cosmetic', '🔱',  false),
('Оружие "Длинный меч"', 'Норманнский длинный меч',              300, 'cosmetic', '⚔️', false),
-- Броня / Плащи
('Броня "Кольчуга"',     'Кованая кольчуга мастера',             400, 'cosmetic', '🛡',  false),
('Броня "Нагрудник Ярла"','Украшенный нагрудник знатного воина', 600, 'cosmetic', '🛡',  false),
('Плащ "Медвежья шкура"','Плащ из медвежьей шкуры',              350, 'cosmetic', '🐾',  false),
('Плащ "Волчья стая"',   'Плащ предводителя волков',             500, 'cosmetic', '🐺',  false)
ON CONFLICT (name) DO NOTHING;

-- 4. Add ammo to roulette prizes (rare / epic / legendary)
-- Rare drops
INSERT INTO gamification_prizes (tier, prize_type, name, description, value, weight, icon, requires_delivery)
SELECT 'rare', 'shop_item',
  s.name, 'Выпало с Колеса Норн!',
  s.id, 28, s.icon, false
FROM gamification_shop_items s
WHERE s.name IN ('Шлем "Рогатый"', 'Оружие "Боевой топор"', 'Оружие "Длинный меч"', 'Броня "Кольчуга"', 'Плащ "Медвежья шкура"')
ON CONFLICT DO NOTHING;

-- Epic drops
INSERT INTO gamification_prizes (tier, prize_type, name, description, value, weight, icon, requires_delivery)
SELECT 'epic', 'shop_item',
  s.name, 'Эпическая добыча!',
  s.id, 6, s.icon, false
FROM gamification_shop_items s
WHERE s.name IN ('Шлем "Берсерка"', 'Оружие "Молот Тора"', 'Броня "Нагрудник Ярла"', 'Плащ "Волчья стая"')
ON CONFLICT DO NOTHING;

-- Legendary drops
INSERT INTO gamification_prizes (tier, prize_type, name, description, value, weight, icon, requires_delivery)
SELECT 'legendary', 'shop_item',
  s.name, 'Легендарный дар богов!',
  s.id, 2, s.icon, false
FROM gamification_shop_items s
WHERE s.name IN ('Шлем "Ярла"', 'Оружие "Копьё Одина"')
ON CONFLICT DO NOTHING;

-- 5. Add more avatars to shop (for variety)
INSERT INTO gamification_shop_items (name, description, price_runes, category, icon, requires_delivery) VALUES
('Аватар "Воин"',        'Простой воин Асгарда',                 100, 'digital',  '🧝',  false),
('Аватар "Берсерк"',     'Яростный берсерк',                     200, 'digital',  '🪓',  false),
('Аватар "Вёльва"',      'Мудрая провидица рун',                 250, 'digital',  '🔮',  false),
('Аватар "Скальд"',      'Певец и рассказчик',                   200, 'digital',  '🎶',  false)
ON CONFLICT (name) DO NOTHING;

-- Add some new avatars to roulette too
INSERT INTO gamification_prizes (tier, prize_type, name, description, value, weight, icon, requires_delivery)
SELECT 'rare', 'shop_item',
  s.name, 'Новый аватар!',
  s.id, 20, s.icon, false
FROM gamification_shop_items s
WHERE s.name IN ('Аватар "Воин"', 'Аватар "Берсерк"', 'Аватар "Вёльва"', 'Аватар "Скальд"')
ON CONFLICT DO NOTHING;
