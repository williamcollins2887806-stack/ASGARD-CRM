-- V269 down: откат расширения напоминаний личного канбана.

ALTER TABLE personal_kanban_card_reminders
  DROP CONSTRAINT IF EXISTS chk_pk_reminders_kind,
  DROP CONSTRAINT IF EXISTS chk_pk_reminders_lead,
  DROP CONSTRAINT IF EXISTS chk_pk_reminders_channels,
  DROP CONSTRAINT IF EXISTS chk_pk_reminders_title_len;

ALTER TABLE personal_kanban_card_reminders
  DROP COLUMN IF EXISTS reminder_kind,
  DROP COLUMN IF EXISTS event_at,
  DROP COLUMN IF EXISTS lead_minutes,
  DROP COLUMN IF EXISTS channels,
  DROP COLUMN IF EXISTS title,
  DROP COLUMN IF EXISTS notify_status;

ALTER TABLE users DROP COLUMN IF EXISTS max_user_id;
