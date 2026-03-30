-- ═══════════════════════════════════════════════════════════════
-- V062: Интеграция просчётов с Хугинн + Мимир-автоответчик
-- ═══════════════════════════════════════════════════════════════

-- 1. chats: auto_created flag (entity_type/entity_id already exist)
ALTER TABLE chats ADD COLUMN IF NOT EXISTS auto_created BOOLEAN DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_chats_entity ON chats(entity_type, entity_id) WHERE entity_type IS NOT NULL;

-- 2. Системный пользователь Мимир (бот)
INSERT INTO users (login, name, role, email, is_active, password_hash)
VALUES ('mimir_bot', 'Мимир', 'BOT', 'mimir@asgard.local', true, '$2b$10$BOT_NO_LOGIN_HASH_PLACEHOLDER')
ON CONFLICT (login) DO NOTHING;

-- 3. Расширение chat_messages для специальных типов
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS message_type VARCHAR(30) DEFAULT 'text';
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 4. Двусторонняя связь approval_comments <-> chat_messages
ALTER TABLE approval_comments ADD COLUMN IF NOT EXISTS chat_message_id INTEGER;
ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS approval_comment_id INTEGER;

-- 5. Конфигурация автоответов Мимира
CREATE TABLE IF NOT EXISTS mimir_auto_config (
  id SERIAL PRIMARY KEY,
  entity_type VARCHAR(50) NOT NULL,
  trigger_action VARCHAR(30) NOT NULL,
  enabled BOOLEAN DEFAULT true,
  system_prompt TEXT,
  max_tokens INTEGER DEFAULT 500,
  delay_seconds INTEGER DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entity_type, trigger_action)
);

INSERT INTO mimir_auto_config (entity_type, trigger_action, enabled, delay_seconds) VALUES
  ('estimate', 'rework', true, 5),
  ('estimate', 'question', true, 3),
  ('estimate', 'reject', true, 5),
  ('estimate', 'comment', true, 10)
ON CONFLICT DO NOTHING;

-- 6. Лог автоответов Мимира
CREATE TABLE IF NOT EXISTS mimir_auto_log (
  id SERIAL PRIMARY KEY,
  chat_id INTEGER REFERENCES chats(id),
  estimate_id INTEGER,
  trigger_action VARCHAR(30),
  trigger_comment TEXT,
  response TEXT,
  tokens_input INTEGER,
  tokens_output INTEGER,
  duration_ms INTEGER,
  scenario VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mimir_auto_log_chat ON mimir_auto_log(chat_id);
