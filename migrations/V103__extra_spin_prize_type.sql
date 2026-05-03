-- V103: Fix "Доп. спин Колеса" prize_type: shop_item → extra_spin
-- So winning it from the wheel auto-credits to inventory (no PM delivery needed).
-- The extra_spin handler inserts 'Доп. спин' into gamification_inventory
-- which the spin-allowance check picks up via: item_name ILIKE '%спин%'

UPDATE gamification_prizes SET prize_type = 'extra_spin' WHERE id = 38;

-- Clean up existing pending fulfillments for extra spin prizes —
-- move them to inventory directly so workers can use them now
INSERT INTO gamification_inventory (employee_id, item_type, item_name, item_description, item_category, source_id, source_type)
SELECT gf.employee_id, 'spin_prize', 'Доп. спин', 'Дополнительное вращение Колеса Норн', 'digital', gf.inventory_id, 'spin'
FROM gamification_fulfillment gf
WHERE gf.item_name ILIKE '%спин%'
  AND gf.status IN ('pending', 'requested')
  AND NOT EXISTS (
    SELECT 1 FROM gamification_inventory gi
    WHERE gi.employee_id = gf.employee_id
      AND gi.source_id = gf.inventory_id
      AND gi.item_name = 'Доп. спин'
  );

-- Delete those fulfillment records (no longer needed)
DELETE FROM gamification_fulfillment
WHERE item_name ILIKE '%спин%'
  AND status IN ('pending', 'requested');
