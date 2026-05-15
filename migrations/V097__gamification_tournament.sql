-- V097: Real weekly gamification tournament
-- ════════════════════════════════════════════════════════════════
-- Stores weekly tournament brackets (fixed at start of week,
-- finalized at end of week). warrior_power = shifts*300 + xp*8 + runes*1

CREATE TABLE IF NOT EXISTS gamification_tournaments (
  id                SERIAL PRIMARY KEY,
  week_start        DATE NOT NULL UNIQUE,   -- Monday 00:00 MSK
  week_end          DATE NOT NULL,           -- Sunday 23:59 MSK
  status            VARCHAR(20) NOT NULL DEFAULT 'active', -- active | completed
  seeding           JSONB NOT NULL DEFAULT '[]',
  -- seeding: [{seed:1, employee_id:X, fio:'...', warrior_power:N}, ...]
  -- seed #1 = strongest, #16 = weakest; #1 vs #16, #2 vs #15, ...
  champion_id       INTEGER REFERENCES employees(id),
  champion_name     VARCHAR(255),
  champion_power    INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_gamification_tournaments_week
  ON gamification_tournaments (week_start);

CREATE INDEX IF NOT EXISTS idx_gamification_tournaments_status
  ON gamification_tournaments (status);
