-- V131: Интеграция с мессенджером MAX
-- Поля для хранения MAX chat_id в работах и статуса приглашения у рабочих

-- Чат MAX для работы
ALTER TABLE works
  ADD COLUMN IF NOT EXISTS max_chat_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS max_invite_link TEXT,
  ADD COLUMN IF NOT EXISTS max_chat_created_at TIMESTAMPTZ;

-- Статус приглашения / вступления рабочего в MAX чат
ALTER TABLE employee_assignments
  ADD COLUMN IF NOT EXISTS max_invite_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_joined_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_user_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS max_invite_status VARCHAR(20) DEFAULT 'not_sent'
    CHECK (max_invite_status IN ('not_sent','sms_sent','joined','failed'));

-- Индекс для поиска по max_user_id (вебхук обновления)
CREATE INDEX IF NOT EXISTS idx_ea_max_user_id ON employee_assignments(max_user_id)
  WHERE max_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_works_max_chat_id ON works(max_chat_id)
  WHERE max_chat_id IS NOT NULL;
