-- Track provider acceptance and delivery receipts for Huginn phone verification.
-- No codes or provider secrets are stored here; the existing bcrypt hash remains authoritative.
ALTER TABLE huginn_login_codes
  ADD COLUMN IF NOT EXISTS delivery_ref TEXT,
  ADD COLUMN IF NOT EXISTS delivery_channel TEXT,
  ADD COLUMN IF NOT EXISTS delivery_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS delivery_error TEXT,
  ADD COLUMN IF NOT EXISTS delivery_updated_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_huginn_login_codes_delivery_ref
  ON huginn_login_codes (delivery_ref)
  WHERE delivery_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_huginn_login_codes_provider_message
  ON huginn_login_codes (delivery_channel, provider_message_id)
  WHERE provider_message_id IS NOT NULL;
