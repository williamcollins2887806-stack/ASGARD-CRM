-- V092: Shop items + inventory + fulfillment

-- 1. Shop catalog (buy with Runes)
CREATE TABLE IF NOT EXISTS gamification_shop_items (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    price_runes INTEGER NOT NULL CHECK (price_runes > 0),
    category VARCHAR(30) NOT NULL CHECK (category IN ('merch', 'digital', 'privilege', 'cosmetic')),
    icon VARCHAR(10),
    image_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    max_stock INTEGER,  -- NULL = unlimited
    current_stock INTEGER DEFAULT 0,
    requires_delivery BOOLEAN DEFAULT FALSE,
    season_id VARCHAR(50),
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Player inventory (purchased/won items)
CREATE TABLE IF NOT EXISTS gamification_inventory (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    item_type VARCHAR(30) NOT NULL CHECK (item_type IN ('shop_purchase', 'spin_prize', 'achievement_reward')),
    item_name VARCHAR(255) NOT NULL,
    item_description TEXT,
    source_id INTEGER,  -- FK to shop_item or prize
    source_type VARCHAR(30),  -- 'shop', 'spin', 'achievement'
    is_used BOOLEAN DEFAULT FALSE,
    is_delivered BOOLEAN DEFAULT FALSE,
    acquired_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gi_employee ON gamification_inventory(employee_id);

-- 3. Fulfillment tracking (physical items delivery)
CREATE TABLE IF NOT EXISTS gamification_fulfillment (
    id SERIAL PRIMARY KEY,
    inventory_id INTEGER NOT NULL REFERENCES gamification_inventory(id),
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    item_name VARCHAR(255) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'delivered', 'cancelled')),
    assigned_pm INTEGER REFERENCES users(id),  -- PM responsible for delivery
    delivery_note TEXT,
    delivered_at TIMESTAMP,
    delivered_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gf_status ON gamification_fulfillment(status);
CREATE INDEX IF NOT EXISTS idx_gf_employee ON gamification_fulfillment(employee_id);

-- Seed: 15 shop items
INSERT INTO gamification_shop_items (name, description, price_runes, category, icon, requires_delivery) VALUES
-- Merch
('Термокружка ASGARD',     'С логотипом и руной',     500, 'merch', '☕', true),
('Бейсболка ASGARD',       'Чёрная с вышивкой',       400, 'merch', '🧢', true),
('Носки "Викинг"',         'Тёплые с орнаментом',     200, 'merch', '🧦', true),
('Перчатки рабочие PRO',   'Усиленные, размер M-XL',  300, 'merch', '🧤', true),
('Наклейка на каску',      'Набор из 3 рун',          100, 'merch', '🪖', true),
-- Digital
('Аватар "Один"',          'Эксклюзивный аватар',     150, 'digital', '🖼', false),
('Аватар "Тор"',           'Эксклюзивный аватар',     150, 'digital', '🖼', false),
('Рамка "Золотые руны"',   'Рамка для профиля',       250, 'digital', '✨', false),
('Тема "Тёмный Асгард"',   'Тёмная тема интерфейса',  200, 'digital', '🌑', false),
-- Privileges
('Выходной по желанию',    'Один внеплановый выходной', 2000, 'privilege', '🏖', false),
('Приоритет в расписании', 'Выбор смены на неделю',    1500, 'privilege', '📅', false),
('Обед от компании',       'Доставка обеда на объект',  300, 'privilege', '🍱', false),
-- Cosmetic
('Бейдж "Берсерк"',       'Редкий профильный бейдж',   400, 'cosmetic', '🪓', false),
('Бейдж "Скальд"',        'Для тех кто много рассказывает', 300, 'cosmetic', '🎶', false),
('Эффект "Молния"',       'Анимация при чекине',       600, 'cosmetic', '⚡', false)
ON CONFLICT DO NOTHING;
