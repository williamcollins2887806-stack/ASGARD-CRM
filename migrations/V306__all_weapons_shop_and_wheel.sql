-- V306: All equippable weapons available in shop + Wheel of Norns
-- Gaps vs avatar WEAPON_TINT map: dagger, axe_shield, forge_hammer, guard_spear
-- Also re-ensure classic V096 weapons stay on the wheel (idempotent).

-- Ensure shop rows exist (no-op if already from V096/V295)
INSERT INTO gamification_shop_items
  (name, description, price_runes, category, icon, requires_delivery, equip_slot, asset_key)
VALUES
  ('Оружие "Боевой топор"',  'Двуручный топор воина Асгарда', 250, 'cosmetic', '🪓', false, 'weapon', 'weapon_axe'),
  ('Оружие "Молот Тора"',    'Легендарный Мьёльнир Тора', 500, 'cosmetic', '🔨', false, 'weapon', 'weapon_hammer'),
  ('Оружие "Копьё Одина"',   'Гунгнир — копьё Всеотца', 800, 'cosmetic', '🔱', false, 'weapon', 'weapon_spear'),
  ('Оружие "Длинный меч"',   'Норманнский длинный меч', 300, 'cosmetic', '⚔️', false, 'weapon', 'weapon_sword'),
  ('Оружие "Короткий топор"','Одноручный топор', 140, 'cosmetic', '🪓', false, 'weapon', 'weapon_handaxe'),
  ('Оружие "Секира"',        'Тяжёлая боевая секира', 380, 'cosmetic', '🪓', false, 'weapon', 'weapon_battleaxe'),
  ('Оружие "Клинок ярла"',   'Украшенный меч', 620, 'cosmetic', '⚔️', false, 'weapon', 'weapon_jarl_sword'),
  ('Оружие "Кинжал"',        'Скрытый клинок', 100, 'cosmetic', '🗡️', false, 'weapon', 'weapon_dagger'),
  ('Оружие "Лук"',           'Длинный лук охотника', 280, 'cosmetic', '🏹', false, 'weapon', 'weapon_bow'),
  ('Оружие "Щит+топор"',     'Комплект щит и топор', 400, 'cosmetic', '🛡️', false, 'weapon', 'weapon_axe_shield'),
  ('Оружие "Трезубец"',      'Морской трезубец', 520, 'cosmetic', '🔱', false, 'weapon', 'weapon_trident'),
  ('Оружие "Молот кузни"',   'Рабочий молот воина', 220, 'cosmetic', '🔨', false, 'weapon', 'weapon_forge_hammer'),
  ('Оружие "Копьё стража"',  'Длинное копьё дозора', 300, 'cosmetic', '🗡️', false, 'weapon', 'weapon_guard_spear'),
  ('Оружие "Пламенный меч"', 'Клинок с огненным оттенком', 800, 'cosmetic', '🔥', false, 'weapon', 'weapon_flame_sword')
ON CONFLICT (name) DO UPDATE SET
  equip_slot = EXCLUDED.equip_slot,
  asset_key = COALESCE(gamification_shop_items.asset_key, EXCLUDED.asset_key),
  category = 'cosmetic',
  is_active = true,
  requires_delivery = false;

-- Backfill asset_key / equip_slot if rows existed without them
UPDATE gamification_shop_items SET equip_slot = 'weapon', asset_key = 'weapon_axe'
WHERE name = 'Оружие "Боевой топор"' AND (equip_slot IS NULL OR asset_key IS NULL);
UPDATE gamification_shop_items SET equip_slot = 'weapon', asset_key = 'weapon_hammer'
WHERE name = 'Оружие "Молот Тора"' AND (equip_slot IS NULL OR asset_key IS NULL);
UPDATE gamification_shop_items SET equip_slot = 'weapon', asset_key = 'weapon_spear'
WHERE name = 'Оружие "Копьё Одина"' AND (equip_slot IS NULL OR asset_key IS NULL);
UPDATE gamification_shop_items SET equip_slot = 'weapon', asset_key = 'weapon_sword'
WHERE name = 'Оружие "Длинный меч"' AND (equip_slot IS NULL OR asset_key IS NULL);

-- Put EVERY active weapon SKU on the Wheel (digital drop, no delivery)
INSERT INTO gamification_prizes (tier, prize_type, name, description, value, weight, icon, requires_delivery, is_active)
SELECT
  CASE
    WHEN s.price_runes >= 700 THEN 'legendary'
    WHEN s.price_runes >= 400 THEN 'epic'
    ELSE 'rare'
  END,
  'shop_item',
  s.name,
  'Оружие с Колеса Норн',
  s.id,
  CASE
    WHEN s.price_runes >= 700 THEN 2
    WHEN s.price_runes >= 400 THEN 6
    ELSE 16
  END,
  s.icon,
  false,
  true
FROM gamification_shop_items s
WHERE s.equip_slot = 'weapon'
  AND s.asset_key LIKE 'weapon_%'
  AND COALESCE(s.is_active, true) = true
  AND NOT EXISTS (
    SELECT 1 FROM gamification_prizes p
    WHERE p.is_active = true
      AND (
        p.name = s.name
        OR (p.prize_type IN ('shop_item', 'cosmetic_item') AND p.value = s.id)
      )
  );
