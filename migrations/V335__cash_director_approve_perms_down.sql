-- down V335: откат прав кассы к состоянию до выдачи write директорам/РП.
-- DIRECTOR_GEN cash/cash_admin write оставляем (это V210, не V335).

UPDATE role_presets SET can_write = false
 WHERE role = 'DIRECTOR_COMM' AND module_key IN ('cash', 'cash_admin');

UPDATE role_presets SET can_write = false
 WHERE role = 'DIRECTOR_DEV' AND module_key IN ('cash', 'cash_admin');

UPDATE role_presets SET can_write = false
 WHERE role IN ('PM', 'HEAD_PM') AND module_key = 'cash';
