-- V186: Время вылета/прилёта рейса + направление на медосмотр + ежедневная отметка присутствия офиса.
--
-- 1) field_logistics: date_from/date_to хранят только ДАТУ (без времени суток). Для анимации/учёта
--    «во сколько вылет/прилёт» добавляем departure_at/arrival_at (TIMESTAMPTZ) и transport_no (№ рейса/поезда).
--    Старые записи продолжают работать (новые колонки nullable; код фолбэчит на date_from/date_to).
-- 2) field_trip_stages: дата ВЫДАЧИ направления на медосмотр (referral_at) — раньше хранилась только
--    дата самого медосмотра (date_from). Nullable, без CHECK.
-- 3) daily_presence: обязательная ежедневная отметка офисных сотрудников «где я сегодня». Полевые
--    рабочие отмечаются через field_checkins, поэтому отдельная лёгкая таблица только для офиса.
--    Ключ — users.id (JWT-идентичность). UNIQUE(user_id, date) — одна отметка в день.

ALTER TABLE field_logistics
  ADD COLUMN IF NOT EXISTS departure_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS arrival_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS transport_no VARCHAR(60);

ALTER TABLE field_trip_stages
  ADD COLUMN IF NOT EXISTS referral_at  DATE;

CREATE TABLE IF NOT EXISTS daily_presence (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  date        DATE    NOT NULL DEFAULT CURRENT_DATE,
  status      VARCHAR(30) NOT NULL,          -- office | remote | object | vacation | sick | trip
  site_id     INTEGER REFERENCES sites(id),  -- заполняется когда status='object'
  note        VARCHAR(255),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_daily_presence_user_date UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_daily_presence_date ON daily_presence(date);
CREATE INDEX IF NOT EXISTS idx_daily_presence_user ON daily_presence(user_id);
