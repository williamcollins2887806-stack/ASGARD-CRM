-- V316: inactivity warn/depart for crew (5d email / 7d auto-leave)
ALTER TABLE employee_assignments
  ADD COLUMN IF NOT EXISTS inactivity_warned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS inactivity_auto_departed_at TIMESTAMPTZ;

COMMENT ON COLUMN employee_assignments.inactivity_warned_at IS
  'Когда РП получил письмо «нет отметок ≥5 дней». Нужно для безопасного авто-убытия (не сносить без предупреждения).';
COMMENT ON COLUMN employee_assignments.inactivity_auto_departed_at IS
  'Когда cron автоматически выставил departure_date = дата последней отметки (idle ≥7д).';
