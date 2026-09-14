-- V306: Virtual cosmetics/digital are unlimited stock; soft set tags for avatar fit.
-- Physical/privilege stay paused elsewhere (V305). Existing inventory untouched.

-- 1) Unlimited stock for virtual wearables (no "РАСКУПЛЕНО" from default current_stock=0)
UPDATE gamification_shop_items
SET current_stock = NULL,
    max_stock = NULL,
    is_limited = false
WHERE is_active = true
  AND COALESCE(requires_delivery, false) = false
  AND category IN ('digital', 'cosmetic');

-- 2) Soft set tag for thematic fit (nullable TEXT). Derived from asset_key.
ALTER TABLE gamification_shop_items
  ADD COLUMN IF NOT EXISTS set_tag TEXT;

UPDATE gamification_shop_items SET set_tag = CASE
  WHEN asset_key ILIKE '%dragon%' THEN 'dragon'
  WHEN asset_key ILIKE '%ice%' OR asset_key ILIKE '%frost%' THEN 'ice'
  WHEN asset_key ILIKE '%fire%' OR asset_key ILIKE '%flame%' OR asset_key ILIKE '%ember%' THEN 'fire'
  WHEN asset_key ILIKE '%shadow%' OR asset_key ILIKE '%night%'
    OR asset_key IN ('helmet_skull', 'helmet_raven', 'cape_raven') THEN 'shadow'
  WHEN asset_key ILIKE '%jarl%' OR asset_key ILIKE '%gold%' THEN 'jarl'
  WHEN asset_key ILIKE '%valkyrie%' THEN 'valkyrie'
  WHEN asset_key ILIKE '%berserk%' THEN 'berserk'
  WHEN equip_slot IN ('helmet','weapon','armor','cape','boots','face_paint','avatar') THEN 'neutral'
  ELSE NULL
END
WHERE category IN ('digital', 'cosmetic');

-- 3) Ensure equip metadata present for known names still missing keys
UPDATE gamification_shop_items SET equip_slot = 'helmet', asset_key = COALESCE(asset_key, 'helmet_steel')
WHERE category = 'cosmetic' AND equip_slot IS NULL AND (name ILIKE '%шлем%' OR name ILIKE '%маска%');
UPDATE gamification_shop_items SET equip_slot = 'weapon', asset_key = COALESCE(asset_key, 'weapon_axe')
WHERE category = 'cosmetic' AND equip_slot IS NULL AND name ILIKE '%оружие%';
UPDATE gamification_shop_items SET equip_slot = 'armor', asset_key = COALESCE(asset_key, 'armor_chain')
WHERE category = 'cosmetic' AND equip_slot IS NULL AND name ILIKE '%брон%';
UPDATE gamification_shop_items SET equip_slot = 'cape', asset_key = COALESCE(asset_key, 'cape_crimson')
WHERE category = 'cosmetic' AND equip_slot IS NULL AND name ILIKE '%плащ%';
UPDATE gamification_shop_items SET equip_slot = 'boots', asset_key = COALESCE(asset_key, 'boots_travel')
WHERE category = 'cosmetic' AND equip_slot IS NULL AND (name ILIKE '%сапог%' OR name ILIKE '%ботин%');
UPDATE gamification_shop_items SET equip_slot = 'face_paint', asset_key = COALESCE(asset_key, 'paint_warrior')
WHERE category = 'cosmetic' AND equip_slot IS NULL AND name ILIKE '%раскраск%';
UPDATE gamification_shop_items SET equip_slot = 'avatar', asset_key = COALESCE(asset_key, 'body_warrior')
WHERE category IN ('cosmetic','digital') AND equip_slot IS NULL AND name ILIKE '%аватар%';
