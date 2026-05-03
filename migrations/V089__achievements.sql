-- V089: Achievement system tables + seed 47 achievements
-- Phase 2 of gamification mega-conveyor
-- Does NOT include roulette/wheel tables (those are V090+ in Phase 3)

-- 1. Achievement catalog
CREATE TABLE IF NOT EXISTS worker_achievements (
    id VARCHAR(50) PRIMARY KEY,
    category VARCHAR(30) NOT NULL,
    tier VARCHAR(20) NOT NULL,
    points INTEGER NOT NULL DEFAULT 10,
    name VARCHAR(100) NOT NULL,
    description TEXT NOT NULL,
    icon VARCHAR(10),
    sort_order INTEGER DEFAULT 0,
    is_secret BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 2. Earned achievements per employee
CREATE TABLE IF NOT EXISTS employee_achievements (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    achievement_id VARCHAR(50) NOT NULL REFERENCES worker_achievements(id),
    earned_at TIMESTAMP NOT NULL DEFAULT NOW(),
    notified BOOLEAN DEFAULT FALSE,
    points_credited BOOLEAN DEFAULT FALSE,
    metadata JSONB DEFAULT '{}',
    UNIQUE(employee_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_emp_achievements_emp ON employee_achievements(employee_id);
CREATE INDEX IF NOT EXISTS idx_emp_achievements_earned ON employee_achievements(earned_at DESC);

-- 3. Points balance (bridge to Phase 3 gamification wallets)
CREATE TABLE IF NOT EXISTS achievement_points_balance (
    employee_id INTEGER PRIMARY KEY REFERENCES employees(id),
    points_balance INTEGER NOT NULL DEFAULT 0,
    points_earned_total INTEGER NOT NULL DEFAULT 0,
    points_spent_total INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT NOW()
);

-- 4. PWA visit tracking (for secret achievements: Hugin's Eye, Dagaz Rune)
CREATE TABLE IF NOT EXISTS field_app_visits (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(id),
    visit_date DATE NOT NULL,
    visits_count INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(employee_id, visit_date)
);
CREATE INDEX IF NOT EXISTS idx_app_visits_emp ON field_app_visits(employee_id, visit_date DESC);

-- ═══════════════════════════════════════════════════════════════
-- Seed: 47 achievements (7 categories)
-- Tiers: cup=10pts, medal=25pts, order=50pts, legend=100pts
-- ═══════════════════════════════════════════════════════════════

INSERT INTO worker_achievements (id, category, tier, points, name, description, icon, sort_order, is_secret) VALUES
-- Вступление (Onboarding)
('new_viking',       'onboarding', 'cup',    10, 'Новый викинг',       'Отработай первую смену',                        '🏆', 1,  false),
('bifrost_guard',    'onboarding', 'cup',    10, 'Страж Бифроста',     'Первый чекин до 08:00',                         '🌉', 2,  false),
('odin_son',         'onboarding', 'cup',    10, 'Сын Одина',          'Отработай 5 смен',                              '⚡', 3,  false),
('valkyrie_path',    'onboarding', 'medal',  25, 'Путь Валькирии',     'Отработай 10 смен',                             '🛡', 4,  false),
('seasoned_viking',  'onboarding', 'medal',  25, 'Бывалый викинг',     'Отработай 30 смен',                             '⚔️', 5,  false),
('asgard_warrior',   'onboarding', 'order',  50, 'Воин Асгарда',       'Отработай 100 смен',                            '🗡', 6,  false),
('saga_keeper',      'onboarding', 'legend', 100,'Хранитель саги',     'Отработай 300 смен',                            '📜', 7,  false),
-- Дисциплина (Discipline)
('iron_warrior',     'discipline', 'medal',  25, 'Железный воин',      '10 смен подряд без пропусков',                  '🔩', 10, false),
('mjolnir',          'discipline', 'order',  50, 'Мьёльнир',           '30 смен подряд без пропусков',                  '🔨', 11, false),
('indomitable',      'discipline', 'legend', 100,'Неукротимый',        '60 смен подряд без пропусков',                  '🌋', 12, false),
('clean_record',     'discipline', 'medal',  25, 'Чистая запись',      '30 дней без штрафов',                           '📋', 13, false),
('early_bird',       'discipline', 'cup',    10, 'Ранняя пташка',      '10 чекинов до 07:30',                           '🐦', 14, false),
('time_keeper',      'discipline', 'order',  50, 'Хранитель времени',  '50 смен с чекином вовремя',                     '⏰', 15, false),
('no_miss',          'discipline', 'medal',  25, 'Без промаха',        '20 чекинов подряд вовремя',                     '🎯', 16, false),
('fate_forger',      'discipline', 'legend', 100,'Кузнец судьбы',      '100 смен подряд без пропуска',                  '🔥', 17, false),
('discipline_shield','discipline', 'order',  50, 'Щит дисциплины',     '90 дней без штрафов',                           '🛡', 18, false),
-- Выносливость (Endurance)
('night_guard',      'endurance',  'cup',    10, 'Ночной страж',       '5 ночных смен',                                 '🌙', 20, false),
('moon_warrior',     'endurance',  'medal',  25, 'Лунный воин',        '20 ночных смен',                                '🌑', 21, false),
('fenrir_spirit',    'endurance',  'order',  50, 'Дух Фенрира',        '50 ночных смен',                                '🐺', 22, false),
('hel_master',       'endurance',  'legend', 100,'Хозяин Хеля',        '100 ночных смен',                               '💀', 23, false),
('marathoner',       'endurance',  'medal',  25, 'Марафонец',          '10 смен по 12+ часов',                          '🏃', 24, false),
('berserker',        'endurance',  'order',  50, 'Берсеркер',          '30 дней подряд без выходных',                   '🪓', 25, false),
('eternal_flame',    'endurance',  'order',  50, 'Вечный огонь',       '20 смен по 12+ часов',                          '🔥', 26, false),
-- Командировки (Travel)
('east_path',        'travel',     'cup',    10, 'Путь на восток',     'Первая командировка (вахта)',                   '🧭', 30, false),
('world_wanderer',   'travel',     'medal',  25, 'Странник миров',     'Работал на 3 разных объектах',                  '🗺', 31, false),
('road_lord',        'travel',     'order',  50, 'Повелитель дорог',   '10 командировок',                               '🛣', 32, false),
('land_opener',      'travel',     'medal',  25, 'Открыватель земель', 'Работал у 5 разных заказчиков',                 '🏴', 33, false),
('bifrost_bridge',   'travel',     'order',  50, 'Мост через Бифрост', 'Командировка в другой регион',                  '🌈', 34, false),
('nine_worlds',      'travel',     'legend', 100,'Девять миров',       'Работал на 9 разных объектах',                  '🌍', 35, false),
('five_seas',        'travel',     'order',  50, 'Викинг пяти морей',  'Работал в 5 разных городах',                    '⚓', 36, false),
-- Финансы (Finance)
('fafnir_gold',      'finance',    'cup',    10, 'Золото Фафнира',     'Заработал 50 000 руб.',                         '💰', 40, false),
('midgard_treasury', 'finance',    'medal',  25, 'Сокровищница Мидгарда','Заработал 200 000 руб.',                      '🏛', 41, false),
('dragon_hoard',     'finance',    'order',  50, 'Драконья казна',     'Заработал 500 000 руб.',                        '🐉', 42, false),
('valhalla_wealth',  'finance',    'legend', 100,'Богатство Валхаллы',  'Заработал 1 000 000 руб.',                     '👑', 43, false),
('clean_account',    'finance',    'medal',  25, 'Чистый счёт',        'Все авансы закрыты, нет долгов',                '✅', 44, false),
('thrifty_jarl',     'finance',    'order',  50, 'Бережливый ярл',     '5 месяцев без долгов',                          '🏺', 45, false),
('first_gold',       'finance',    'cup',    10, 'Первое золото',      'Подтвердил первую выплату',                     '🪙', 46, false),
-- Мастерство (Mastery)
('apprentice',       'mastery',    'cup',    10, 'Ученик',             'Первое назначение на объект',                   '📚', 50, false),
('right_hand',       'mastery',    'medal',  25, 'Правая рука мастера','20 смен помощником',                            '🤝', 51, false),
('master_resp',      'mastery',    'order',  50, 'Мастер ответственный','Назначен мастером',                            '🎖', 52, false),
('brigade_viking',   'mastery',    'order',  50, 'Бригадир-викинг',    '50 смен мастером',                              '⚔️', 53, false),
('work_king',        'mastery',    'legend', 100,'Конунг работ',       '100+ смен мастером',                            '👑', 54, false),
('shapeshifter',     'mastery',    'medal',  25, 'Многоликий',         'Работал на 3+ категориях объектов',             '🎭', 55, false),
-- Секретные (Secret) — описания скрыты от игроков
('hugin_eye',        'secret',     'order',  50, 'Око Хугина',         '???',                                           '👁', 90, true),
('dagaz_rune',       'secret',     'legend', 100,'Руна Дагаз',         '???',                                           '᛭', 91, true),
('chronicler',       'secret',     'order',  50, 'Летописец Асгарда',  '???',                                           '📷', 92, true),
('odin_chosen',      'secret',     'legend', 100,'Избранный Одина',    '???',                                           '✨', 93, true)
ON CONFLICT (id) DO NOTHING;
