-- V295: Expand equippable cosmetics to dozens + wheel prizes
-- Idempotent: ON CONFLICT (name) DO UPDATE for slots/keys

-- Ensure unique name index (from V096)
CREATE UNIQUE INDEX IF NOT EXISTS idx_gsi_name ON gamification_shop_items(name);

-- Backfill remaining known items without equip_slot
UPDATE gamification_shop_items SET equip_slot = 'avatar', asset_key = 'body_odin'
WHERE name ILIKE '%аватар%один%' AND (equip_slot IS NULL OR asset_key IS NULL);
UPDATE gamification_shop_items SET equip_slot = 'avatar', asset_key = 'body_thor'
WHERE name ILIKE '%аватар%тор%' AND (equip_slot IS NULL OR asset_key IS NULL);
UPDATE gamification_shop_items SET equip_slot = 'avatar', asset_key = 'body_volva'
WHERE name ILIKE '%вёльва%' OR name ILIKE '%вельва%';
UPDATE gamification_shop_items SET equip_slot = 'avatar', asset_key = 'body_skald'
WHERE name ILIKE '%скальд%' AND name ILIKE '%аватар%';
UPDATE gamification_shop_items SET equip_slot = 'frame', asset_key = 'frame_gold_runes'
WHERE name ILIKE '%рамк%золотые%';
UPDATE gamification_shop_items SET equip_slot = 'theme', asset_key = 'theme_dark'
WHERE name ILIKE '%тема%тёмный%' OR name ILIKE '%тема%темный%';
UPDATE gamification_shop_items SET equip_slot = 'badge', asset_key = 'badge_berserk'
WHERE name = 'Бейдж "Берсерк"';
UPDATE gamification_shop_items SET equip_slot = 'badge', asset_key = 'badge_skald'
WHERE name = 'Бейдж "Скальд"';
UPDATE gamification_shop_items SET equip_slot = 'face_paint', asset_key = 'paint_lightning'
WHERE name ILIKE '%молния%';

-- ── New catalog (~48 SKUs) ─────────────────────────────────────────────────
INSERT INTO gamification_shop_items
  (name, description, price_runes, category, icon, requires_delivery, equip_slot, asset_key)
VALUES
-- Helmets (10 new + existing covered)
('Шлем "Железный купол"', 'Простой спангенхельм без рогов', 120, 'cosmetic', '🪖', false, 'helmet', 'helmet_dome'),
('Шлем "Скрытный"', 'Лёгкий шлем разведчика', 150, 'cosmetic', '🪖', false, 'helmet', 'helmet_scout'),
('Шлем "Драконий"', 'Гребень в форме дракона', 700, 'cosmetic', '🐉', false, 'helmet', 'helmet_dragon'),
('Шлем "Ледяной"', 'Синяя сталь севера', 550, 'cosmetic', '❄️', false, 'helmet', 'helmet_ice'),
('Шлем "Огненный"', 'Красная закалка кузни', 550, 'cosmetic', '🔥', false, 'helmet', 'helmet_fire'),
('Шлем "Ворона"', 'Чёрный шлем Хугина', 480, 'cosmetic', '🐦‍⬛', false, 'helmet', 'helmet_raven'),
('Маска "Череп"', 'Ритуальная маска', 650, 'cosmetic', '💀', false, 'helmet', 'helmet_skull'),
('Шлем "Золотой"', 'Полностью позолоченный', 900, 'cosmetic', '👑', false, 'helmet', 'helmet_gold'),
('Шлем "Рунный"', 'Врезанные руны защиты', 420, 'cosmetic', 'ᚱ', false, 'helmet', 'helmet_rune'),
('Шлем "Валькирии"', 'Крылатый шлем', 750, 'cosmetic', '🪽', false, 'helmet', 'helmet_valkyrie'),

-- Weapons
('Оружие "Короткий топор"', 'Одноручный топор', 140, 'cosmetic', '🪓', false, 'weapon', 'weapon_handaxe'),
('Оружие "Секира"', 'Тяжёлая боевая секира', 380, 'cosmetic', '🪓', false, 'weapon', 'weapon_battleaxe'),
('Оружие "Клинок ярла"', 'Украшенный меч', 620, 'cosmetic', '⚔️', false, 'weapon', 'weapon_jarl_sword'),
('Оружие "Кинжал"', 'Скрытый клинок', 100, 'cosmetic', '🗡️', false, 'weapon', 'weapon_dagger'),
('Оружие "Лук"', 'Длинный лук охотника', 280, 'cosmetic', '🏹', false, 'weapon', 'weapon_bow'),
('Оружие "Щит+топор"', 'Комплект щит и топор', 400, 'cosmetic', '🛡️', false, 'weapon', 'weapon_axe_shield'),
('Оружие "Трезубец"', 'Морской трезубец', 520, 'cosmetic', '🔱', false, 'weapon', 'weapon_trident'),
('Оружие "Молот кузни"', 'Рабочий молот воина', 220, 'cosmetic', '🔨', false, 'weapon', 'weapon_forge_hammer'),
('Оружие "Копьё стража"', 'Длинное копьё дозора', 300, 'cosmetic', '🗡️', false, 'weapon', 'weapon_guard_spear'),
('Оружие "Пламенный меч"', 'Клинок с огненным оттенком', 800, 'cosmetic', '🔥', false, 'weapon', 'weapon_flame_sword'),

-- Armor
('Броня "Кожаная"', 'Лёгкая кожаная кираса', 130, 'cosmetic', '🦺', false, 'armor', 'armor_leather'),
('Броня "Пластинчатая"', 'Тяжёлые пластины', 500, 'cosmetic', '🛡️', false, 'armor', 'armor_plate'),
('Броня "Рунная"', 'Кольчуга с рунами', 450, 'cosmetic', 'ᚨ', false, 'armor', 'armor_rune'),
('Броня "Драконья"', 'Чешуйчатый доспех', 850, 'cosmetic', '🐉', false, 'armor', 'armor_dragon'),
('Броня "Ледяная"', 'Синяя стальная кираса', 600, 'cosmetic', '❄️', false, 'armor', 'armor_ice'),
('Броня "Огненная"', 'Красный латный нагрудник', 600, 'cosmetic', '🔥', false, 'armor', 'armor_fire'),
('Броня "Теневая"', 'Чёрная незаметная броня', 480, 'cosmetic', '🌑', false, 'armor', 'armor_shadow'),
('Броня "Золотая"', 'Парадный золотой доспех', 950, 'cosmetic', '✨', false, 'armor', 'armor_gold'),

-- Capes
('Плащ "Алый"', 'Ярко-красный плащ', 180, 'cosmetic', '🧣', false, 'cape', 'cape_crimson'),
('Плащ "Ночной"', 'Чёрный плащ тени', 200, 'cosmetic', '🌑', false, 'cape', 'cape_night'),
('Плащ "Ледяной"', 'Синий мех севера', 320, 'cosmetic', '❄️', false, 'cape', 'cape_frost'),
('Плащ "Огненный"', 'Оранжево-красный', 320, 'cosmetic', '🔥', false, 'cape', 'cape_ember'),
('Плащ "Ворона"', 'Чёрные перья', 400, 'cosmetic', '🐦‍⬛', false, 'cape', 'cape_raven'),
('Плащ "Золотой"', 'Парчовый плащ ярла', 700, 'cosmetic', '👑', false, 'cape', 'cape_gold'),

-- Boots
('Сапоги "Походные"', 'Простые кожаные', 90, 'cosmetic', '🥾', false, 'boots', 'boots_travel'),
('Сапоги "Стальные"', 'Усиленные металлом', 200, 'cosmetic', '🥾', false, 'boots', 'boots_steel'),
('Сапоги "Теневые"', 'Тихие чёрные', 250, 'cosmetic', '🌑', false, 'boots', 'boots_shadow'),
('Сапоги "Ярла"', 'Украшенные золотом', 450, 'cosmetic', '👑', false, 'boots', 'boots_jarl'),
('Сапоги "Ледяные"', 'Синяя отделка', 300, 'cosmetic', '❄️', false, 'boots', 'boots_ice'),
('Сапоги "Огненные"', 'Красная кожа', 300, 'cosmetic', '🔥', false, 'boots', 'boots_fire'),

-- Face paint
('Раскраска "Воин"', 'Синие полосы войны', 80, 'cosmetic', '🎨', false, 'face_paint', 'paint_warrior'),
('Раскраска "Берсерк"', 'Кровавые полосы', 120, 'cosmetic', '🩸', false, 'face_paint', 'paint_berserk'),
('Раскраска "Рунная"', 'Руны на щеках', 150, 'cosmetic', 'ᚱ', false, 'face_paint', 'paint_runes'),
('Раскраска "Тень"', 'Чёрная маска', 140, 'cosmetic', '🌑', false, 'face_paint', 'paint_shadow'),
('Раскраска "Лёд"', 'Синие узоры', 160, 'cosmetic', '❄️', false, 'face_paint', 'paint_ice'),
('Раскраска "Огонь"', 'Красные узоры', 160, 'cosmetic', '🔥', false, 'face_paint', 'paint_fire'),

-- Bodies / avatars
('Аватар "Страж"', 'Дозорный вала', 180, 'digital', '🛡️', false, 'avatar', 'body_guard'),
('Аватар "Кузнеца"', 'Мастер кузни', 200, 'digital', '🔨', false, 'avatar', 'body_smith'),
('Аватар "Охотник"', 'Следопыт леса', 180, 'digital', '🏹', false, 'avatar', 'body_hunter'),
('Аватар "Ярл"', 'Знатный вождь', 500, 'digital', '👑', false, 'avatar', 'body_jarl'),
('Аватар "Валькирия"', 'Крылатая воительница', 550, 'digital', '🪽', false, 'avatar', 'body_valkyrie'),
('Аватар "Тень"', 'Тёмный разведчик', 350, 'digital', '🌑', false, 'avatar', 'body_shadow'),

-- Frames / badges extras
('Рамка "Лёд"', 'Ледяная рамка профиля', 220, 'digital', '❄️', false, 'frame', 'frame_ice'),
('Рамка "Огонь"', 'Огненная рамка', 220, 'digital', '🔥', false, 'frame', 'frame_fire'),
('Бейдж "Страж"', 'Знак дозора', 180, 'cosmetic', '🛡️', false, 'badge', 'badge_guard'),
('Бейдж "Ярл"', 'Знак вождя', 350, 'cosmetic', '👑', false, 'badge', 'badge_jarl')
ON CONFLICT (name) DO UPDATE SET
  equip_slot = EXCLUDED.equip_slot,
  asset_key = EXCLUDED.asset_key,
  description = EXCLUDED.description,
  price_runes = EXCLUDED.price_runes,
  category = EXCLUDED.category,
  icon = EXCLUDED.icon,
  is_active = true;

-- Wheel prizes: ~40% of new catalog as cosmetic_item / avatar_frame
INSERT INTO gamification_prizes (tier, prize_type, name, description, value, weight, icon, requires_delivery, is_active)
SELECT
  CASE
    WHEN s.price_runes >= 700 THEN 'legendary'
    WHEN s.price_runes >= 400 THEN 'epic'
    ELSE 'rare'
  END,
  CASE WHEN s.equip_slot IN ('avatar', 'frame', 'theme') THEN 'avatar_frame' ELSE 'cosmetic_item' END,
  s.name,
  'Добыча Колеса Норн',
  s.id,
  CASE
    WHEN s.price_runes >= 700 THEN 2
    WHEN s.price_runes >= 400 THEN 6
    ELSE 18
  END,
  s.icon,
  false,
  true
FROM gamification_shop_items s
WHERE s.asset_key IS NOT NULL
  AND s.category IN ('digital', 'cosmetic')
  AND s.name IN (
    'Шлем "Железный купол"', 'Шлем "Скрытный"', 'Шлем "Драконий"', 'Шлем "Ледяной"',
    'Шлем "Огненный"', 'Шлем "Ворона"', 'Маска "Череп"', 'Шлем "Рунный"',
    'Оружие "Короткий топор"', 'Оружие "Секира"', 'Оружие "Клинок ярла"', 'Оружие "Лук"',
    'Оружие "Трезубец"', 'Оружие "Пламенный меч"',
    'Броня "Кожаная"', 'Броня "Пластинчатая"', 'Броня "Драконья"', 'Броня "Теневая"',
    'Плащ "Алый"', 'Плащ "Ночной"', 'Плащ "Ворона"', 'Плащ "Золотой"',
    'Сапоги "Походные"', 'Сапоги "Стальные"', 'Сапоги "Ярла"',
    'Раскраска "Воин"', 'Раскраска "Берсерк"', 'Раскраска "Рунная"',
    'Аватар "Страж"', 'Аватар "Ярл"', 'Аватар "Валькирия"', 'Аватар "Тень"',
    'Рамка "Лёд"', 'Рамка "Огонь"', 'Бейдж "Страж"'
  )
  AND NOT EXISTS (
    SELECT 1 FROM gamification_prizes p WHERE p.name = s.name AND p.is_active = true
  );
