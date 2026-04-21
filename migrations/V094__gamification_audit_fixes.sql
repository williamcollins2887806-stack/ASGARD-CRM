-- V094: Gamification audit fixes (HIGH severity)
-- Adds: rarity, is_limited, lore columns; CHECK constraints; ON DELETE; indexes

BEGIN;

-- C5: Add rarity to shop_items
ALTER TABLE gamification_shop_items ADD COLUMN IF NOT EXISTS rarity VARCHAR(20) DEFAULT 'common'
  CHECK (rarity IN ('common', 'rare', 'epic', 'legendary'));
ALTER TABLE gamification_shop_items ADD COLUMN IF NOT EXISTS is_limited BOOLEAN DEFAULT FALSE;

-- C4: Add missing quest fields
ALTER TABLE gamification_quests ADD COLUMN IF NOT EXISTS lore TEXT;
ALTER TABLE gamification_quests ADD COLUMN IF NOT EXISTS reward_item VARCHAR(255);
ALTER TABLE gamification_quests ADD COLUMN IF NOT EXISTS season_end DATE;
ALTER TABLE gamification_quests ADD COLUMN IF NOT EXISTS required_level INTEGER;

-- D3: CHECK weight >= 0 on prizes
ALTER TABLE gamification_prizes DROP CONSTRAINT IF EXISTS gamification_prizes_weight_check;
ALTER TABLE gamification_prizes ADD CONSTRAINT gamification_prizes_weight_check CHECK (weight >= 0);

-- D4: CHECK current_stock >= 0
ALTER TABLE gamification_shop_items DROP CONSTRAINT IF EXISTS gsi_stock_check;
ALTER TABLE gamification_shop_items ADD CONSTRAINT gsi_stock_check CHECK (current_stock >= 0 OR current_stock IS NULL);
ALTER TABLE gamification_prizes DROP CONSTRAINT IF EXISTS gp_stock_check;
ALTER TABLE gamification_prizes ADD CONSTRAINT gp_stock_check CHECK (current_stock >= 0 OR current_stock IS NULL);

-- D2: ON DELETE CASCADE for employee FK (core tables)
ALTER TABLE gamification_wallets DROP CONSTRAINT IF EXISTS gamification_wallets_employee_id_fkey;
ALTER TABLE gamification_wallets ADD CONSTRAINT gamification_wallets_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE gamification_currency_ledger DROP CONSTRAINT IF EXISTS gamification_currency_ledger_employee_id_fkey;
ALTER TABLE gamification_currency_ledger ADD CONSTRAINT gamification_currency_ledger_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE gamification_spins DROP CONSTRAINT IF EXISTS gamification_spins_employee_id_fkey;
ALTER TABLE gamification_spins ADD CONSTRAINT gamification_spins_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE gamification_inventory DROP CONSTRAINT IF EXISTS gamification_inventory_employee_id_fkey;
ALTER TABLE gamification_inventory ADD CONSTRAINT gamification_inventory_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE gamification_fulfillment DROP CONSTRAINT IF EXISTS gamification_fulfillment_employee_id_fkey;
ALTER TABLE gamification_fulfillment ADD CONSTRAINT gamification_fulfillment_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE gamification_quest_progress DROP CONSTRAINT IF EXISTS gamification_quest_progress_employee_id_fkey;
ALTER TABLE gamification_quest_progress ADD CONSTRAINT gamification_quest_progress_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE gamification_pity_counters DROP CONSTRAINT IF EXISTS gamification_pity_counters_employee_id_fkey;
ALTER TABLE gamification_pity_counters ADD CONSTRAINT gamification_pity_counters_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

ALTER TABLE gamification_streaks DROP CONSTRAINT IF EXISTS gamification_streaks_employee_id_fkey;
ALTER TABLE gamification_streaks ADD CONSTRAINT gamification_streaks_employee_id_fkey
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE;

-- D7: Missing indexes
CREATE INDEX IF NOT EXISTS idx_gs_spin_at ON gamification_spins(spin_at);
CREATE INDEX IF NOT EXISTS idx_gf_inventory ON gamification_fulfillment(inventory_id);
CREATE INDEX IF NOT EXISTS idx_gsi_category ON gamification_shop_items(category) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_gq_type ON gamification_quests(quest_type) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_gp_active ON gamification_prizes(is_active) WHERE is_active = true;

COMMIT;
