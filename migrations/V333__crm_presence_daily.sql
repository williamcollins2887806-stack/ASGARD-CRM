-- V333: учёт реального времени в CRM по heartbeat (вкладка открыта)
-- Клиент уже шлёт POST /api/daily-presence/heartbeat ~каждые 30с.
-- С понедельника 07.09.2026 накопление идёт в эту таблицу.

CREATE TABLE IF NOT EXISTS crm_presence_daily (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day            DATE NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0,
  tick_count     INTEGER NOT NULL DEFAULT 0,
  first_seen_at  TIMESTAMPTZ,
  last_seen_at   TIMESTAMPTZ,
  PRIMARY KEY (user_id, day)
);

CREATE INDEX IF NOT EXISTS idx_crm_presence_daily_day
  ON crm_presence_daily (day);

COMMENT ON TABLE crm_presence_daily IS
  'Активное время в CRM: сумма интервалов между heartbeat при видимой вкладке';
