-- V208: DIRECTOR_GEN permissions для кассы / админ-задач / чатов.
-- C-9: D-2 browser-test нашёл что DIRECTOR_GEN не имеет cash:write / tasks_admin:write /
-- chat_groups:write в role_presets. Большинство endpoint'ов смотрят только на роль,
-- но эти 3 модуля проверяют permission — директор получал 403.
--
-- Полные права (read+write) — директор по бизнесу может всё в этих модулях.
-- can_delete=false: удаление платежей/задач/групп должно идти через ADMIN
-- (защита от случайных destructive операций даже у директора).

INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('DIRECTOR_GEN', 'cash',         true, true,  false),
  ('DIRECTOR_GEN', 'cash_admin',   true, true,  false),
  ('DIRECTOR_GEN', 'tasks_admin',  true, true,  false),
  ('DIRECTOR_GEN', 'chat_groups',  true, true,  false)
ON CONFLICT (role, module_key) DO UPDATE SET
  can_read  = EXCLUDED.can_read  OR role_presets.can_read,
  can_write = EXCLUDED.can_write OR role_presets.can_write;
