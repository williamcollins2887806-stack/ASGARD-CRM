-- V268 down: снять пресеты permits, добавленные этой миграцией.
-- (Персональные user_permissions не трогаем.)
DELETE FROM role_presets
WHERE module_key = 'permits'
  AND role IN ('HR','HR_MANAGER','TO','HEAD_TO','PM','HEAD_PM',
               'DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV');
