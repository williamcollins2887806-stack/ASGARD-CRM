-- V335: права кассы под фактический поток выдачи наличных.
--
-- Баг: DIRECTOR_COMM (Гажилиев) имел cash_admin.can_write=false (V084),
-- а согласование идёт через requirePermission('cash_admin','write') → 403.
-- DIRECTOR_GEN получил write в V210, DIRECTOR_DEV — нет строки вообще.
-- PM/HEAD_PM имели cash.can_write=false (V083) → не могли создать заявку
-- и подтвердить получение (кроме точечных user_permissions).
--
-- BUH по-прежнему cash_admin.write (выдача), но согласование режется
-- в коде canApprove() — не ролью BUH.

INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('PM',            'cash',        true, true,  false),
  ('HEAD_PM',       'cash',        true, true,  false),
  ('HEAD_TO',       'cash',        true, true,  false),
  ('DIRECTOR_COMM', 'cash',        true, true,  false),
  ('DIRECTOR_GEN',  'cash',        true, true,  false),
  ('DIRECTOR_DEV',  'cash',        true, true,  false),
  ('DIRECTOR_COMM', 'cash_admin',  true, true,  false),
  ('DIRECTOR_GEN',  'cash_admin',  true, true,  false),
  ('DIRECTOR_DEV',  'cash_admin',  true, true,  false),
  ('BUH',           'cash_admin',  true, true,  false),
  ('BUH',           'cash',        true, false, false)
ON CONFLICT (role, module_key) DO UPDATE SET
  can_read   = EXCLUDED.can_read  OR role_presets.can_read,
  can_write  = EXCLUDED.can_write OR role_presets.can_write,
  can_delete = COALESCE(EXCLUDED.can_delete, role_presets.can_delete, false);

-- Если у пользователя точечно выключили write в user_permissions — не трогаем.
-- Только подтягиваем тех, у кого строки модуля нет: они уже читают role_presets.
