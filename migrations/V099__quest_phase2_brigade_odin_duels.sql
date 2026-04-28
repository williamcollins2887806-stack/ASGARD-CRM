-- V099: Phase 2 — Brigade quests, Odin's challenge, Duels
BEGIN;

-- ═══════════════════════════════════════════════════════════════
-- 1. BRIGADE QUESTS — shared team goal, reward split among participants
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gamification_brigade_quests (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    lore TEXT,
    icon VARCHAR(10) DEFAULT '🛡️',
    target_action VARCHAR(50) NOT NULL,  -- photo_upload, shift_complete, early_checkin
    target_count INTEGER NOT NULL,
    reward_per_person INTEGER NOT NULL DEFAULT 20,  -- runes per participant
    quest_type VARCHAR(20) NOT NULL DEFAULT 'weekly' CHECK (quest_type IN ('daily','weekly','monthly')),
    current_count INTEGER DEFAULT 0,
    completed BOOLEAN DEFAULT FALSE,
    completed_at TIMESTAMP,
    reward_distributed BOOLEAN DEFAULT FALSE,
    period_start DATE NOT NULL DEFAULT CURRENT_DATE,
    created_by INTEGER REFERENCES users(id),
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gbq_work_active ON gamification_brigade_quests(work_id, is_active) WHERE is_active = true;

-- Seed: brigade quests for work_id=11 (current object)
INSERT INTO gamification_brigade_quests (work_id, name, description, lore, icon, target_action, target_count, reward_per_person, quest_type) VALUES
(11, 'Стена щитов', 'Бригада: 80 фото за неделю', 'Когда дружина стоит плечом к плечу, стена щитов непробиваема. Каждое фото — щит в общей стене. 80 щитов — и враг отступит.', '🛡️', 'photo_upload', 80, 25, 'weekly'),
(11, 'Рассвет дружины', 'Бригада: 0 опозданий за неделю (все до 07:30)', 'Если хоть один воин опоздает — строй рассыпается. Вся дружина на месте к рассвету — и Бифрёст сияет для всех.', '🌅', 'early_checkin', 90, 30, 'weekly'),
(11, 'Молот и наковальня', 'Бригада: 100 завершённых смен за неделю', 'Как кузнец Брок ковал Мьёльнир — без остановки, удар за ударом. 100 смен за неделю — и бригада выковала свою легенду.', '🔨', 'shift_complete', 100, 20, 'weekly')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════════
-- 2. ODIN'S CHALLENGE — daily custom task from PM/master
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gamification_odin_challenges (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    title VARCHAR(255) NOT NULL,
    description TEXT NOT NULL,
    lore TEXT,
    icon VARCHAR(10) DEFAULT '👁️',
    reward_runes INTEGER NOT NULL DEFAULT 40,
    challenge_date DATE NOT NULL DEFAULT CURRENT_DATE,
    verification_type VARCHAR(30) NOT NULL DEFAULT 'photo' CHECK (verification_type IN ('photo','checkin','manual')),
    created_by INTEGER REFERENCES users(id),  -- PM or master who created it
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(work_id, challenge_date)  -- one challenge per project per day
);

-- Track who completed the challenge
CREATE TABLE IF NOT EXISTS gamification_odin_completions (
    id SERIAL PRIMARY KEY,
    challenge_id INTEGER NOT NULL REFERENCES gamification_odin_challenges(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    proof_photo_url VARCHAR(500),  -- if photo verification
    completed_at TIMESTAMP DEFAULT NOW(),
    reward_claimed BOOLEAN DEFAULT FALSE,
    verified_by INTEGER REFERENCES users(id),  -- master/PM who verified
    verified_at TIMESTAMP,
    UNIQUE(challenge_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_goc_challenge ON gamification_odin_completions(challenge_id);
CREATE INDEX IF NOT EXISTS idx_godin_work_date ON gamification_odin_challenges(work_id, challenge_date);

-- ═══════════════════════════════════════════════════════════════
-- 3. DUELS — 1v1 challenges between workers
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gamification_duels (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    challenger_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    opponent_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    duel_type VARCHAR(30) NOT NULL DEFAULT 'photos' CHECK (duel_type IN ('photos','hours','shifts')),
    stake_runes INTEGER NOT NULL DEFAULT 10,
    duel_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','active','completed','cancelled')),
    -- Results (filled on completion)
    challenger_score NUMERIC(10,2) DEFAULT 0,
    opponent_score NUMERIC(10,2) DEFAULT 0,
    winner_id INTEGER REFERENCES employees(id),
    reward_paid BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    resolved_at TIMESTAMP,
    -- Max 1 active duel per person per day
    CONSTRAINT no_self_duel CHECK (challenger_id != opponent_id)
);

CREATE INDEX IF NOT EXISTS idx_gd_date ON gamification_duels(duel_date, status);
CREATE INDEX IF NOT EXISTS idx_gd_challenger ON gamification_duels(challenger_id, duel_date);
CREATE INDEX IF NOT EXISTS idx_gd_opponent ON gamification_duels(opponent_id, duel_date);

COMMIT;
