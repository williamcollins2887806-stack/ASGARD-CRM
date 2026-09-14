-- V305: Pause physical merch/food delivery + privilege prizes (day-off, shift pick, lunch).
-- Existing inventory + fulfillment rows are NOT touched — PM still delivers them.
-- Wheel weights rebalanced so remaining virtual prizes keep sensible odds.

-- ── 1) Shop: deactivate merch / delivery / privilege ─────────────────────────
UPDATE gamification_shop_items
SET is_active = false
WHERE is_active = true
  AND (
    requires_delivery = true
    OR category = 'merch'
    OR category = 'privilege'
    OR name ILIKE '%выходн%'
    OR name ILIKE '%приоритет%смен%'
    OR name ILIKE '%выбор%смен%'
    OR name ILIKE '%обед%'
  );

-- ── 2) Wheel prizes: deactivate physical + privilege-linked ──────────────────
UPDATE gamification_prizes
SET is_active = false
WHERE is_active = true
  AND (
    requires_delivery = true
    OR prize_type = 'merch'
    OR name ILIKE '%выходн%'
    OR name ILIKE '%приоритет%'
    OR name ILIKE '%выбор%смен%'
    OR name ILIKE '%обед%'
    OR name ILIKE '%доширак%'
    OR name ILIKE '%печенье%'
    OR name ILIKE '%кофе%'
    OR name ILIKE '%энергетик%'
    OR name ILIKE '%куртк%'
    OR name ILIKE '%футболк%'
    OR name ILIKE '%толстовк%'
    OR name ILIKE '%термос%'
    OR name ILIKE '%повербанк%'
    OR name ILIKE '%термокруж%'
    OR name ILIKE '%бейсболк%'
    OR name ILIKE '%носки%'
    OR name ILIKE '%перчатк%'
    OR name ILIKE '%наклейк%каск%'
  );

-- Shop_item prizes whose linked shop row is now inactive
UPDATE gamification_prizes p
SET is_active = false
WHERE p.is_active = true
  AND p.prize_type = 'shop_item'
  AND p.value IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM gamification_shop_items s
    WHERE s.id = p.value AND s.is_active = false
  );

-- ── 3) Rebalance remaining active wheel weights ──────────────────────────────
-- Target mix after pause: ~55% runes, ~25% xp, ~15% cosmetics, ~5% boosts/extra
UPDATE gamification_prizes SET weight = CASE
  WHEN prize_type = 'runes' AND value <= 15 THEN 120
  WHEN prize_type = 'runes' AND value <= 30 THEN 90
  WHEN prize_type = 'runes' AND value <= 75 THEN 40
  WHEN prize_type = 'runes' AND value <= 250 THEN 12
  WHEN prize_type = 'runes' THEN 4
  WHEN prize_type = 'xp' AND value <= 30 THEN 70
  WHEN prize_type = 'xp' AND value <= 50 THEN 35
  WHEN prize_type = 'xp' THEN 12
  WHEN prize_type = 'multiplier' THEN 8
  WHEN prize_type = 'extra_spin' THEN 10
  WHEN prize_type IN ('sticker', 'avatar_frame', 'cosmetic_item', 'vip') AND tier = 'common' THEN 28
  WHEN prize_type IN ('sticker', 'avatar_frame', 'cosmetic_item', 'vip') AND tier = 'rare' THEN 18
  WHEN prize_type IN ('sticker', 'avatar_frame', 'cosmetic_item', 'vip') AND tier = 'epic' THEN 6
  WHEN prize_type IN ('sticker', 'avatar_frame', 'cosmetic_item', 'vip') AND tier = 'legendary' THEN 2
  WHEN prize_type = 'shop_item' AND tier = 'rare' THEN 14
  WHEN prize_type = 'shop_item' AND tier = 'epic' THEN 5
  WHEN prize_type = 'shop_item' AND tier = 'legendary' THEN 2
  WHEN prize_type = 'shop_item' THEN 20
  ELSE GREATEST(weight, 5)
END
WHERE is_active = true AND weight > 0;
