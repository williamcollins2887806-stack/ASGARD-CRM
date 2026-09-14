-- V334: журнал входов в приложение рабочих (append-only)
-- field_sessions.created_at нельзя использовать как историю: refresh удаляет сессию и создаёт новую.

CREATE TABLE IF NOT EXISTS field_app_logins (
  id           BIGSERIAL PRIMARY KEY,
  employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  method       VARCHAR(20) NOT NULL DEFAULT 'unknown', -- sms | pin | backfill
  device_info  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_field_app_logins_created
  ON field_app_logins (created_at);

CREATE INDEX IF NOT EXISTS idx_field_app_logins_emp_day
  ON field_app_logins (employee_id, ((created_at AT TIME ZONE 'Europe/Moscow')::date));

COMMENT ON TABLE field_app_logins IS
  'Факт входа в Field App (SMS/PIN). Не удаляется при refresh сессии.';

-- Бэкфилл: текущие живые сессии как приблизительные входы
INSERT INTO field_app_logins (employee_id, user_id, method, device_info, created_at)
SELECT fs.employee_id, e.user_id, 'backfill', LEFT(COALESCE(fs.device_info, ''), 200),
       COALESCE(fs.created_at, NOW())
FROM field_sessions fs
JOIN employees e ON e.id = fs.employee_id
WHERE NOT EXISTS (
  SELECT 1 FROM field_app_logins l
  WHERE l.employee_id = fs.employee_id
    AND ABS(EXTRACT(EPOCH FROM (l.created_at - COALESCE(fs.created_at, NOW())))) < 60
);

-- Бэкфилл: кто логинился раньше, но сессии уже нет
INSERT INTO field_app_logins (employee_id, user_id, method, device_info, created_at)
SELECT e.id, e.user_id, 'backfill', NULL, e.field_last_login
FROM employees e
WHERE e.field_last_login IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM field_app_logins l WHERE l.employee_id = e.id
  );
