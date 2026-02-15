-- V022: Add webhook_secret column for HMAC signature validation
ALTER TABLE erp_connections ADD COLUMN IF NOT EXISTS webhook_secret VARCHAR(128);

COMMENT ON COLUMN erp_connections.webhook_secret IS 'HMAC-SHA256 secret for webhook signature validation';
