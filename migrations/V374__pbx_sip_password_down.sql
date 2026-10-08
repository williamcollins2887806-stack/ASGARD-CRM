-- V374 down: drop SIP plaintext password column.
ALTER TABLE pbx_operators DROP COLUMN IF EXISTS sip_password;
