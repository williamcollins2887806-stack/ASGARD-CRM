-- V359 down: откат PBX core

DROP VIEW IF EXISTS call_history_record_url_compat;

DROP INDEX IF EXISTS idx_employees_phone2_last10;
DROP INDEX IF EXISTS idx_employees_phone_last10;
DROP INDEX IF EXISTS idx_customers_phone_last10;

DELETE FROM settings WHERE key = 'pbx_config';

DROP INDEX IF EXISTS idx_call_history_source;
DROP INDEX IF EXISTS idx_call_history_pbx_uid;

ALTER TABLE call_history DROP COLUMN IF EXISTS outcome;
ALTER TABLE call_history DROP COLUMN IF EXISTS wait_seconds;
ALTER TABLE call_history DROP COLUMN IF EXISTS answered_by;
ALTER TABLE call_history DROP COLUMN IF EXISTS source;
ALTER TABLE call_history DROP COLUMN IF EXISTS pbx_uid;
ALTER TABLE call_history DROP COLUMN IF EXISTS recording_url;

DROP INDEX IF EXISTS idx_pbx_call_legs_user_started;
DROP INDEX IF EXISTS idx_pbx_call_legs_call_id;
DROP TABLE IF EXISTS pbx_call_legs;

DROP INDEX IF EXISTS idx_pbx_operators_sort;
DROP INDEX IF EXISTS idx_pbx_operators_on_line;
DROP TABLE IF EXISTS pbx_operators;
