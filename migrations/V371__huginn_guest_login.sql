-- Huginn guest login: passwordless entry (SMS code / email magic link).
CREATE TABLE IF NOT EXISTS huginn_login_codes (
  id           BIGSERIAL PRIMARY KEY,
  phone        TEXT,
  email        TEXT,
  code_hash    TEXT,
  token        TEXT UNIQUE,
  kind         TEXT NOT NULL DEFAULT 'sms' CHECK (kind IN ('sms','email')),
  attempts     INTEGER NOT NULL DEFAULT 0,
  used         BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_huginn_login_codes_phone ON huginn_login_codes (phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_huginn_login_codes_email ON huginn_login_codes (email, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_huginn_login_codes_token ON huginn_login_codes (token);

-- Guests were created with login 'hg_<digits>' while the app asks for a phone.
-- Remember the phone/email on the user so password fallback and lookups work.
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_huginn_guest BOOLEAN NOT NULL DEFAULT false;
