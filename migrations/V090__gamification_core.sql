-- V090: Gamification core — wallets, ledger, settings
-- Phase 3 of gamification mega-conveyor

-- 1. Wallets: Silver (1:1 RUB), Runes (shop currency), XP (level progression)
CREATE TABLE IF NOT EXISTS gamification_wallets (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    currency VARCHAR(20) NOT NULL CHECK (currency IN ('silver', 'runes', 'xp')),
    balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(employee_id, currency)
);
CREATE INDEX IF NOT EXISTS idx_gw_employee ON gamification_wallets(employee_id);

-- 2. Double-entry ledger for full auditability
CREATE TABLE IF NOT EXISTS gamification_currency_ledger (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    currency VARCHAR(20) NOT NULL,
    amount INTEGER NOT NULL,  -- positive = credit, negative = debit
    balance_after INTEGER NOT NULL,
    operation VARCHAR(50) NOT NULL,  -- 'spin_win', 'shop_buy', 'achievement_bonus', 'convert', 'admin_grant', 'salary_payout'
    reference_id INTEGER,  -- FK to spin/purchase/achievement
    reference_type VARCHAR(30),  -- 'spin', 'purchase', 'achievement', 'admin'
    note TEXT,
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gcl_employee ON gamification_currency_ledger(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gcl_operation ON gamification_currency_ledger(operation);

-- 3. Global settings for gamification economy
CREATE TABLE IF NOT EXISTS gamification_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed settings
INSERT INTO gamification_settings (key, value, description) VALUES
('spin_reset_hour', '6', 'Hour (MSK) when daily spin resets'),
('silver_to_runes_rate', '10:100', 'Conversion: 10 Silver = 100 Runes'),
('runes_monthly_cap', '15000', 'Max runes earned per month'),
('xp_per_level', '100', 'XP needed per level'),
('pity_guarantee_spins', '50', 'Guaranteed rare after N dry spins'),
('spin_cost', '0', 'Cost per spin (0 = free daily)'),
('season_active', '', 'Current active season event ID')
ON CONFLICT (key) DO NOTHING;
