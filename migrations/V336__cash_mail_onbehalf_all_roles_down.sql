-- down V336

DROP TABLE IF EXISTS cash_email_tokens;

ALTER TABLE cash_requests DROP COLUMN IF EXISTS initiated_by;

-- Не откатываем can_write у ролей, которым write уже давал V335 (PM/HEAD_PM/HEAD_TO/директора).
-- Снимаем write только у тех, кто получил его впервые в V336.
UPDATE role_presets SET can_write = false
 WHERE module_key = 'cash'
   AND role IN ('TO', 'BUH', 'HR', 'HR_MANAGER', 'PROC', 'WAREHOUSE', 'CHIEF_ENGINEER', 'OFFICE_MANAGER', 'FIELD_WORKER');
