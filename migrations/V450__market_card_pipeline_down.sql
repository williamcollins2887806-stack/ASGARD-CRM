-- Down: V450 market card pipeline

DELETE FROM settings WHERE key IN (
  'market_ai_blocked_until',
  'market_ai_daily_budget_rub',
  'market_ai_max_photos'
);

DROP TABLE IF EXISTS market_ai_jobs;

ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_market_card_key_fkey;
ALTER TABLE equipment DROP CONSTRAINT IF EXISTS equipment_photo_source_check;
DROP INDEX IF EXISTS idx_equipment_market_card_key;
ALTER TABLE equipment
  DROP COLUMN IF EXISTS market_card_key,
  DROP COLUMN IF EXISTS photo_source,
  DROP COLUMN IF EXISTS attrs;

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_market_card_key_fkey;
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_photo_source_check;
DROP INDEX IF EXISTS idx_products_market_card_key;
ALTER TABLE products
  DROP COLUMN IF EXISTS market_card_key,
  DROP COLUMN IF EXISTS photo_source;

DROP TABLE IF EXISTS market_card_archetypes;
