-- V093: Quests, streaks, seasonal events, audit log

-- 1. Quest templates
CREATE TABLE IF NOT EXISTS gamification_quests (
    id SERIAL PRIMARY KEY,
    quest_type VARCHAR(30) NOT NULL CHECK (quest_type IN ('daily', 'weekly', 'seasonal', 'permanent')),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    target_action VARCHAR(50) NOT NULL,  -- 'checkin', 'photo', 'report', 'streak', 'earn'
    target_count INTEGER NOT NULL DEFAULT 1,
    reward_type VARCHAR(20) NOT NULL DEFAULT 'runes',
    reward_amount INTEGER NOT NULL DEFAULT 10,
    icon VARCHAR(10),
    season_id VARCHAR(50),  -- NULL = always available
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Quest progress per employee
CREATE TABLE IF NOT EXISTS gamification_quest_progress (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    quest_id INTEGER NOT NULL REFERENCES gamification_quests(id),
    current_count INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP,
    reward_claimed BOOLEAN DEFAULT FALSE,
    started_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(employee_id, quest_id)
);
CREATE INDEX IF NOT EXISTS idx_gqp_employee ON gamification_quest_progress(employee_id);

-- 3. Streaks
CREATE TABLE IF NOT EXISTS gamification_streaks (
    employee_id INTEGER PRIMARY KEY REFERENCES employees(id),
    current_streak INTEGER DEFAULT 0,
    longest_streak INTEGER DEFAULT 0,
    last_active_date DATE,
    streak_freeze_available BOOLEAN DEFAULT FALSE,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. Seasonal events
CREATE TABLE IF NOT EXISTS gamification_seasons (
    id VARCHAR(50) PRIMARY KEY,  -- 'midsummar_2026', 'ragnarok_2026', etc.
    name VARCHAR(255) NOT NULL,
    description TEXT,
    theme VARCHAR(50),  -- 'fire', 'ice', 'summer', 'anniversary'
    starts_at TIMESTAMP NOT NULL,
    ends_at TIMESTAMP NOT NULL,
    is_active BOOLEAN DEFAULT FALSE,
    bonus_multiplier DECIMAL(3,1) DEFAULT 1.0,
    special_prizes JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
);

-- 5. Audit log for critical gamification actions
CREATE TABLE IF NOT EXISTS gamification_audit_log (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id),
    action VARCHAR(50) NOT NULL,  -- 'jackpot', 'merch_delivery', 'admin_grant', 'admin_revoke', 'conversion'
    details JSONB DEFAULT '{}',
    performed_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gal_employee ON gamification_audit_log(employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gal_action ON gamification_audit_log(action);

-- Seed: Quest templates
INSERT INTO gamification_quests (quest_type, name, description, target_action, target_count, reward_type, reward_amount, icon) VALUES
('daily',     'Утренний воин',    'Начни смену сегодня',               'checkin',  1, 'runes', 5,  '🌅'),
('daily',     'Фотоотчёт',       'Сделай фото на объекте',            'photo',    1, 'runes', 5,  '📸'),
('weekly',    'Железная неделя',  'Отработай 5 смен за неделю',        'checkin',  5, 'runes', 30, '💪'),
('weekly',    'Летописец недели', 'Отправь 3 ежедневных отчёта',       'report',   3, 'runes', 20, '📝'),
('weekly',    'Марафон',          'Отработай 50+ часов за неделю',      'earn',     50,'runes', 50, '🏃'),
('permanent', 'Стрик 7 дней',    'Работай 7 дней подряд',             'streak',   7, 'runes', 50, '🔥'),
('permanent', 'Стрик 14 дней',   'Работай 14 дней подряд',            'streak',  14, 'runes', 100,'🔥'),
('permanent', 'Стрик 30 дней',   'Работай 30 дней подряд',            'streak',  30, 'runes', 250,'🔥')
ON CONFLICT DO NOTHING;

-- Seed: Seasonal events (future)
INSERT INTO gamification_seasons (id, name, description, theme, starts_at, ends_at, bonus_multiplier) VALUES
('midsummar_2026', 'Мидсуммар',    'Летний фестиваль',     'summer',      '2026-06-20', '2026-06-30', 1.5),
('ragnarok_2026',  'Рагнарёк',     'Зимний штурм',         'ice',         '2026-12-20', '2026-12-31', 2.0),
('anniversary_2027','Юбилей ASGARD','27 апреля — день основания','anniversary','2027-04-25', '2027-04-29', 2.0)
ON CONFLICT (id) DO NOTHING;
