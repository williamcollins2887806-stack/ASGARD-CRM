-- V336: письма директору по кассе, заявка бухгалтерии за сотрудника,
-- доступ «запросить и получить» для всех офисных ролей CRM.

ALTER TABLE cash_requests
  ADD COLUMN IF NOT EXISTS initiated_by INTEGER REFERENCES users(id);

CREATE INDEX IF NOT EXISTS cash_requests_initiated_by_idx
  ON cash_requests (initiated_by);

COMMENT ON COLUMN cash_requests.initiated_by IS
  'Кто создал заявку. user_id — кому выдадут деньги и чей баланс/история. Если NULL или = user_id — сотрудник запросил сам.';

CREATE TABLE IF NOT EXISTS cash_email_tokens (
  id           SERIAL PRIMARY KEY,
  request_id   INTEGER NOT NULL REFERENCES cash_requests(id) ON DELETE CASCADE,
  token_hash   VARCHAR(64) NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  used_at      TIMESTAMPTZ,
  used_action  VARCHAR(32),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cash_email_tokens_request_idx
  ON cash_email_tokens (request_id);

CREATE INDEX IF NOT EXISTS cash_email_tokens_expires_idx
  ON cash_email_tokens (expires_at);

-- Все офисные роли CRM: читать и писать свою кассу (заявка + подтверждение получения).
-- ADMIN проходит bypass в коде; строка для полноты пресета.
-- cash_admin (выдача/сводка) — только BUH и директора, как раньше.
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('ADMIN',           'cash', true, true, false),
  ('PM',              'cash', true, true, false),
  ('HEAD_PM',         'cash', true, true, false),
  ('TO',              'cash', true, true, false),
  ('HEAD_TO',         'cash', true, true, false),
  ('BUH',             'cash', true, true, false),
  ('HR',              'cash', true, true, false),
  ('HR_MANAGER',      'cash', true, true, false),
  ('PROC',            'cash', true, true, false),
  ('WAREHOUSE',       'cash', true, true, false),
  ('CHIEF_ENGINEER',  'cash', true, true, false),
  ('OFFICE_MANAGER',  'cash', true, true, false),
  ('DIRECTOR_GEN',    'cash', true, true, false),
  ('DIRECTOR_COMM',   'cash', true, true, false),
  ('DIRECTOR_DEV',    'cash', true, true, false),
  ('FIELD_WORKER',    'cash', true, true, false)
ON CONFLICT (role, module_key) DO UPDATE SET
  can_read   = true,
  can_write  = true,
  can_delete = COALESCE(role_presets.can_delete, false);

-- У кого свой набор user_permissions (не preset): без строки cash фронт hasPermission=false.
-- Включаем read+write всем офисным, у кого уже есть персональные права.
INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete)
SELECT DISTINCT u.id, 'cash', true, true, false
FROM users u
    WHERE u.role IN (
      'ADMIN','PM','HEAD_PM','TO','HEAD_TO','BUH','HR','HR_MANAGER','PROC',
      'WAREHOUSE','CHIEF_ENGINEER','OFFICE_MANAGER','DIRECTOR_GEN','DIRECTOR_COMM','DIRECTOR_DEV',
      'FIELD_WORKER'
    )
  AND EXISTS (SELECT 1 FROM user_permissions up WHERE up.user_id = u.id)
ON CONFLICT (user_id, module_key) DO UPDATE SET
  can_read  = true,
  can_write = true,
  can_delete = COALESCE(user_permissions.can_delete, false);
