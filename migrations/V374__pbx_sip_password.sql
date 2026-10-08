-- V374: PBX SIP plaintext password for Asterisk PJSIP provisioning.
-- sip_password_hash остаётся для сверки; sip_password нужен, чтобы сгенерировать
-- PJSIP auth для WebRTC-регистрации оператора.

ALTER TABLE pbx_operators ADD COLUMN IF NOT EXISTS sip_password TEXT;

COMMENT ON COLUMN pbx_operators.sip_password IS 'Plaintext SIP password for PJSIP provisioning (never logged/exposed).';
