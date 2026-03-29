-- Персональные настройки уведомлений об отчётах
CREATE TABLE IF NOT EXISTS call_report_user_prefs (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER NOT NULL REFERENCES users(id),
  report_type  VARCHAR(20) NOT NULL,
  is_enabled   BOOLEAN DEFAULT true,
  via_crm      BOOLEAN DEFAULT true,
  via_huginn   BOOLEAN DEFAULT true,
  via_email    BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, report_type)
);

-- Defaults для директоров
INSERT INTO call_report_user_prefs (user_id, report_type, is_enabled, via_crm, via_huginn, via_email)
SELECT u.id, rt.t, true, true, true, true
FROM users u
CROSS JOIN (VALUES ('daily'), ('weekly'), ('monthly')) AS rt(t)
WHERE u.role IN ('ADMIN', 'DIRECTOR_GEN', 'DIRECTOR_COMM', 'DIRECTOR_DEV')
  AND u.is_active = true
ON CONFLICT (user_id, report_type) DO NOTHING;
