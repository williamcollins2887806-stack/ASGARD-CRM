-- V268: гарантировать пресеты доступа к модулю «Допуски» (permits) в role_presets.
-- Причина: базовые role_presets заводились не миграцией, а через админку, поэтому
-- на части окружений (dev) строк для permits нет вовсе → любой не-ADMIN получает 403.
-- Здесь фиксируем контракт фронта (Permits/api.js): WRITE_ROLES и ALLOWED_READ_ROLES.
--
-- Идемпотентно и без даунгрейда: ON CONFLICT ... DO UPDATE через OR — существующие
-- на проде права не понижаются, только добавляются недостающие.

-- Полный доступ (чтение + запись + удаление) — те, кто ведёт допуски.
-- ТО (тендерный специалист) и HEAD_TO — по требованию: могут добавлять/редактировать.
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('HR',         'permits', true, true, true),
  ('HR_MANAGER', 'permits', true, true, true),
  ('TO',         'permits', true, true, true),
  ('HEAD_TO',    'permits', true, true, true)
ON CONFLICT (role, module_key) DO UPDATE SET
  can_read   = role_presets.can_read   OR EXCLUDED.can_read,
  can_write  = role_presets.can_write  OR EXCLUDED.can_write,
  can_delete = role_presets.can_delete OR EXCLUDED.can_delete;

-- Только чтение — руководство/PM, кто просматривает готовность.
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('PM',            'permits', true, false, false),
  ('HEAD_PM',       'permits', true, false, false),
  ('DIRECTOR_GEN',  'permits', true, false, false),
  ('DIRECTOR_COMM', 'permits', true, false, false),
  ('DIRECTOR_DEV',  'permits', true, false, false)
ON CONFLICT (role, module_key) DO UPDATE SET
  can_read = role_presets.can_read OR EXCLUDED.can_read;
