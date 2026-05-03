-- V104: Digital prizes auto-credit — no PM delivery required
-- Avatars, themes, effects → avatar_frame (handler: direct inventory insert)
-- Cosmetic in-game gear   → cosmetic_item (handler: direct inventory insert)
-- Physical food/merch     → stays shop_item (PM delivery pipeline)

-- Avatars, themes, visual effects — fully digital
UPDATE gamification_prizes SET prize_type = 'avatar_frame'
WHERE id IN (33, 35, 36, 46, 61, 62, 63, 64);
-- 33: Аватар "Один"     35: Аватар "Тор"         36: Тема "Тёмный Асгард"
-- 46: Эффект "Молния"  61: Аватар "Воин"        62: Аватар "Берсерк"
-- 63: Аватар "Вёльва"  64: Аватар "Скальд"

-- In-game cosmetic equipment — digital collectibles, no physical delivery
UPDATE gamification_prizes SET prize_type = 'cosmetic_item'
WHERE id IN (50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60);
-- 50: Шлем "Рогатый"        51: Оружие "Боевой топор"  52: Оружие "Длинный меч"
-- 53: Броня "Кольчуга"      54: Плащ "Медвежья шкура"  55: Шлем "Берсерка"
-- 56: Оружие "Молот Тора"   57: Броня "Нагрудник Ярла" 58: Плащ "Волчья стая"
-- 59: Шлем "Ярла"           60: Оружие "Копьё Одина"

-- Remove pending/requested fulfillments for these digital prizes
-- (inventory items already exist — workers can use them directly)
DELETE FROM gamification_fulfillment
WHERE status IN ('pending', 'requested')
  AND inventory_id IN (
    SELECT gi.id
    FROM gamification_inventory gi
    WHERE gi.source_type = 'spin'
      AND gi.source_id IN (
        33, 35, 36, 46, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64
      )
  );
