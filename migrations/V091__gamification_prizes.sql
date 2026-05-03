-- V091: Prizes catalog + spins + pity counters

-- 1. Prize catalog (Wheel of Norns sectors)
CREATE TABLE IF NOT EXISTS gamification_prizes (
    id SERIAL PRIMARY KEY,
    tier VARCHAR(20) NOT NULL CHECK (tier IN ('common', 'rare', 'epic', 'legendary')),
    prize_type VARCHAR(30) NOT NULL CHECK (prize_type IN ('runes', 'xp', 'multiplier', 'extra_spin', 'sticker', 'avatar_frame', 'vip', 'merch')),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    value INTEGER DEFAULT 0,  -- amount for runes/xp, multiplier value, etc.
    weight INTEGER NOT NULL DEFAULT 100,  -- probability weight
    icon VARCHAR(10),
    image_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    requires_delivery BOOLEAN DEFAULT FALSE,
    max_stock INTEGER,  -- NULL = unlimited
    current_stock INTEGER DEFAULT 0,
    season_id VARCHAR(50),  -- NULL = always available, or season event ID
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Spin history
CREATE TABLE IF NOT EXISTS gamification_spins (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    prize_id INTEGER NOT NULL REFERENCES gamification_prizes(id),
    prize_tier VARCHAR(20) NOT NULL,
    prize_name VARCHAR(255),
    prize_value INTEGER DEFAULT 0,
    is_free BOOLEAN DEFAULT TRUE,
    multiplier_applied INTEGER DEFAULT 1,
    spin_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gs_employee ON gamification_spins(employee_id, spin_at DESC);

-- 3. Pity counter (guaranteed rare after N dry spins)
CREATE TABLE IF NOT EXISTS gamification_pity_counters (
    employee_id INTEGER PRIMARY KEY REFERENCES employees(id),
    spins_since_rare INTEGER DEFAULT 0,
    last_rare_at TIMESTAMP,
    pending_multiplier INTEGER DEFAULT 1,  -- next spin multiplier (Thor's Hammer)
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed: 30 prizes (4 tiers)
INSERT INTO gamification_prizes (tier, prize_type, name, description, value, weight, icon, requires_delivery) VALUES
-- COMMON (base weight 1000)
('common', 'runes',  '5 Рун',           'Маленький дар Норн',       5,    1000, '᛭', false),
('common', 'runes',  '10 Рун',          'Подношение Норн',         10,    800,  '᛭', false),
('common', 'runes',  '15 Рун',          'Благословение Урд',       15,    600,  '᛭', false),
('common', 'runes',  '20 Рун',          'Мудрость Верданди',       20,    400,  '᛭', false),
('common', 'runes',  '30 Рун',          'Пророчество Скульд',      30,    250,  '᛭', false),
('common', 'xp',     '10 XP',           'Опыт воина',              10,    800,  '⚡', false),
('common', 'xp',     '20 XP',           'Тренировка в Вальхалле',  20,    500,  '⚡', false),
('common', 'xp',     '30 XP',           'Урок от эйнхерия',       30,    300,  '⚡', false),
('common', 'xp',     '40 XP',           'Бой с тенью',            40,    200,  '⚡', false),
-- RARE (weight ~100)
('rare',   'runes',  '50 Рун',          'Клад вёльвы',             50,    100,  '✨', false),
('rare',   'runes',  '75 Рун',          'Сокровище Фафнира',       75,    80,   '✨', false),
('rare',   'xp',     '50 XP',           'Благословение Одина',     50,    100,  '🌟', false),
('rare',   'multiplier', 'x2 множитель','Молот Тора',               2,    60,   '🔨', false),
('rare',   'sticker', 'Стикер Рагнар',  'Редкий стикер',            0,    80,   '🎨', false),
('rare',   'extra_spin','Доп. вращение','Ещё один шанс',            1,    50,   '🔄', false),
-- EPIC (weight ~10)
('epic',   'runes',  '250 Рун',         'Кольцо Драупнир',        250,    10,   '💎', false),
('epic',   'runes',  '500 Рун',         'Ожерелье Брисингамен',   500,    6,    '💎', false),
('epic',   'xp',     '100 XP',          'Мёд поэзии',             100,    8,    '🍯', false),
('epic',   'avatar_frame', 'Рамка "Воин"','Золотая рамка аватара',  0,    5,    '🖼', false),
('epic',   'multiplier', 'x3 множитель','Гунгнир',                  3,    4,    '🔱', false),
-- LEGENDARY (weight ~4)
('legendary', 'runes', '1000 Рун',      'Золото Нифльхейма',     1000,    4,    '👑', false),
('legendary', 'merch', 'Футболка ASGARD','Фирменная футболка',      0,    3,    '👕', true),
('legendary', 'merch', 'Толстовка ASGARD','Фирменная толстовка',    0,    2,    '🧥', true),
('legendary', 'merch', 'Термос ASGARD', 'Термос с логотипом',       0,    3,    '☕', true),
('legendary', 'merch', 'Повербанк',     'Повербанк 20000mAh',       0,    2,    '🔋', true),
('legendary', 'vip',   'VIP статус',    'VIP на 30 дней',           30,    3,    '⭐', false)
ON CONFLICT DO NOTHING;
