-- V269: расширение напоминаний личного канбана — тип, событие, lead-time, каналы доставки.
-- Крон по-прежнему срабатывает по remind_at (event_at - lead_minutes).

ALTER TABLE personal_kanban_card_reminders
  ADD COLUMN IF NOT EXISTS reminder_kind TEXT NOT NULL DEFAULT 'task',
  ADD COLUMN IF NOT EXISTS event_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lead_minutes INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS channels     TEXT[] NOT NULL DEFAULT '{inapp}',
  ADD COLUMN IF NOT EXISTS title        TEXT,
  ADD COLUMN IF NOT EXISTS notify_status JSONB;

ALTER TABLE personal_kanban_card_reminders DROP CONSTRAINT IF EXISTS chk_pk_reminders_kind;
ALTER TABLE personal_kanban_card_reminders ADD CONSTRAINT chk_pk_reminders_kind
  CHECK (reminder_kind IN ('call', 'sms', 'meeting', 'task', 'email', 'other'));

ALTER TABLE personal_kanban_card_reminders DROP CONSTRAINT IF EXISTS chk_pk_reminders_lead;
ALTER TABLE personal_kanban_card_reminders ADD CONSTRAINT chk_pk_reminders_lead
  CHECK (lead_minutes >= 0 AND lead_minutes <= 10080);

ALTER TABLE personal_kanban_card_reminders DROP CONSTRAINT IF EXISTS chk_pk_reminders_channels;
ALTER TABLE personal_kanban_card_reminders ADD CONSTRAINT chk_pk_reminders_channels
  CHECK (
    channels IS NOT NULL
    AND array_length(channels, 1) >= 1
    AND channels <@ ARRAY['inapp','whatsapp','max','email']::TEXT[]
  );

ALTER TABLE personal_kanban_card_reminders DROP CONSTRAINT IF EXISTS chk_pk_reminders_title_len;
ALTER TABLE personal_kanban_card_reminders ADD CONSTRAINT chk_pk_reminders_title_len
  CHECK (title IS NULL OR char_length(btrim(title)) BETWEEN 1 AND 200);

-- Для существующих строк: event_at = remind_at, lead = 0
UPDATE personal_kanban_card_reminders
   SET event_at = remind_at
 WHERE event_at IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS max_user_id TEXT;

COMMENT ON COLUMN personal_kanban_card_reminders.reminder_kind IS
  'Тип события: call|sms|meeting|task|email|other';
COMMENT ON COLUMN personal_kanban_card_reminders.event_at IS
  'Время самого события (звонок/встреча). remind_at = event_at - lead_minutes.';
COMMENT ON COLUMN personal_kanban_card_reminders.lead_minutes IS
  'За сколько минут до event_at сработает напоминание.';
COMMENT ON COLUMN personal_kanban_card_reminders.channels IS
  'Каналы доставки: inapp|whatsapp|max|email.';
COMMENT ON COLUMN personal_kanban_card_reminders.notify_status IS
  'Результат доставки по каналам (JSON).';
COMMENT ON COLUMN users.max_user_id IS
  'MAX user_id для личных уведомлений (привязка через бота).';
