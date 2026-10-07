-- Rollback for V371 (guest login codes). is_huginn_guest is left in place:
-- it existed as a runtime-added column and dropping it would break ACL.
DROP INDEX IF EXISTS idx_huginn_login_codes_token;
DROP INDEX IF EXISTS idx_huginn_login_codes_email;
DROP INDEX IF EXISTS idx_huginn_login_codes_phone;
DROP TABLE IF EXISTS huginn_login_codes;
