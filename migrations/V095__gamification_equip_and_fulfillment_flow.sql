-- V095: Gamification — digital item equip slots + fulfillment new flow
-- Run: PGPASSWORD=123456789 psql -U asgard -d asgard_crm -f migrations/V095__gamification_equip_and_fulfillment_flow.sql

-- employees: cosmetic/digital item slots
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS active_badge  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS active_frame  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS active_theme  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS active_avatar VARCHAR(100);

-- gamification_inventory: track equipped state + item category
ALTER TABLE gamification_inventory
  ADD COLUMN IF NOT EXISTS is_equipped   BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS item_category VARCHAR(20);

-- Backfill item_category from shop items for existing shop_purchase rows
UPDATE gamification_inventory gi
SET item_category = gsi.category
FROM gamification_shop_items gsi
WHERE gi.source_id = gsi.id
  AND gi.item_type = 'shop_purchase'
  AND gi.item_category IS NULL;

-- Default remaining rows (spin prizes, etc.) to 'merch'
UPDATE gamification_inventory
SET item_category = 'merch'
WHERE item_category IS NULL;

-- fulfillment: expand status CHECK to include new states
ALTER TABLE gamification_fulfillment
  DROP CONSTRAINT IF EXISTS gamification_fulfillment_status_check;

ALTER TABLE gamification_fulfillment
  ADD CONSTRAINT gamification_fulfillment_status_check
  CHECK (status IN ('pending', 'requested', 'ready', 'delivered', 'confirmed', 'cancelled'));

-- fulfillment: timestamps for new status transitions
ALTER TABLE gamification_fulfillment
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP;
