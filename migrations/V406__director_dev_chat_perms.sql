-- V406: DIRECTOR_DEV — довести права до уровня собратьев-директоров.
--
-- Дефект (аудит мобильной СРМ 17.10.2026): DIRECTOR_DEV имел в role_presets
-- только cash / cash_admin / permits / tasks, тогда как мобильное меню
-- (public/mobile-app/src/config/rbac.js → ROLE_PERMISSIONS.DIRECTOR_DEV)
-- отдаёт ему разделы chat и personnel. Запрос GET /api/chat-groups падал 403
-- («Нет доступа к модулю chat_groups»), а api-клиент мобильного приложения
-- трактует любой не-PIN 403 как «сессия истекла»: стирает токен и выбрасывает
-- директора на /welcome. То есть раздел «Чат» был недоступен даже для просмотра.
--
-- DIRECTOR_COMM (тот же круг обязанностей на мобильном) уже имел chat_groups —
-- приводим DIRECTOR_DEV к тому же набору. can_delete=false: удаление чатов/задач
-- остаётся за ADMIN (защита от случайных destructive-операций).

INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('DIRECTOR_DEV', 'chat_groups', true,  true,  false),
  ('DIRECTOR_DEV', 'tasks',       true,  true,  false),
  ('DIRECTOR_DEV', 'tasks_admin', true,  true,  false)
ON CONFLICT (role, module_key) DO UPDATE SET
  can_read  = EXCLUDED.can_read  OR role_presets.can_read,
  can_write = EXCLUDED.can_write OR role_presets.can_write;

-- Персональные исключения (user_permissions) тоже не должны «обнулять» доступ:
-- если для DIRECTOR_DEV заведены строки по chat_groups — снимаем их, чтобы
-- работал ролевой пресет (requirePermission смотрит user_permissions первым).
DELETE FROM user_permissions
 WHERE module_key IN ('chat_groups', 'tasks', 'tasks_admin')
   AND user_id IN (SELECT id FROM users WHERE role = 'DIRECTOR_DEV');
