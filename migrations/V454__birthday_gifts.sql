-- V454: модуль поздравлений — подарки коллег + официальное письмо Асгарда

CREATE TABLE IF NOT EXISTS birthday_gifts (
  id              BIGSERIAL PRIMARY KEY,
  from_user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gift_type       TEXT NOT NULL CHECK (gift_type IN ('flowers', 'fireworks', 'toy')),
  tone            TEXT NOT NULL DEFAULT 'warm' CHECK (tone IN ('warm', 'saga', 'light')),
  message_text    TEXT,
  message_status  TEXT NOT NULL DEFAULT 'pending'
                    CHECK (message_status IN ('pending', 'ready', 'failed')),
  birthday_year   INTEGER NOT NULL,
  opened_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT birthday_gifts_from_to_year UNIQUE (from_user_id, to_user_id, birthday_year),
  CONSTRAINT birthday_gifts_no_self CHECK (from_user_id <> to_user_id)
);

CREATE INDEX IF NOT EXISTS idx_birthday_gifts_inbox
  ON birthday_gifts (to_user_id, birthday_year, opened_at);
CREATE INDEX IF NOT EXISTS idx_birthday_gifts_pending
  ON birthday_gifts (message_status) WHERE message_status = 'pending';

CREATE TABLE IF NOT EXISTS birthday_asgard_wishes (
  id              BIGSERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  birthday_year   INTEGER NOT NULL,
  message_sms     TEXT,
  message_email   TEXT,
  facts_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  max_status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (max_status IN ('pending', 'sent', 'skipped', 'failed')),
  sms_status      TEXT NOT NULL DEFAULT 'pending'
                    CHECK (sms_status IN ('pending', 'sent', 'skipped', 'failed')),
  email_status    TEXT NOT NULL DEFAULT 'pending'
                    CHECK (email_status IN ('pending', 'sent', 'skipped', 'failed')),
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT birthday_asgard_wishes_user_year UNIQUE (user_id, birthday_year)
);

CREATE INDEX IF NOT EXISTS idx_birthday_asgard_wishes_year
  ON birthday_asgard_wishes (birthday_year);
