-- ═══════════════════════════════════════════════════════════════
-- V014: Мимир — история диалогов и логирование AI
-- ═══════════════════════════════════════════════════════════════

-- Диалоги (сессии чата)
CREATE TABLE IF NOT EXISTS mimir_conversations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) DEFAULT 'Новый диалог',
  is_archived BOOLEAN DEFAULT FALSE,
  is_pinned BOOLEAN DEFAULT FALSE,
  message_count INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  last_message_at TIMESTAMP,
  last_message_preview TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mimir_conv_user_id ON mimir_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_mimir_conv_updated ON mimir_conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_mimir_conv_archived ON mimir_conversations(user_id, is_archived);

-- Сообщения в диалогах
CREATE TABLE IF NOT EXISTS mimir_messages (
  id SERIAL PRIMARY KEY,
  conversation_id INTEGER NOT NULL REFERENCES mimir_conversations(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  content_type VARCHAR(20) DEFAULT 'text' CHECK (content_type IN ('text', 'file_analysis', 'tkp', 'error')),
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  model_used VARCHAR(100),
  has_files BOOLEAN DEFAULT FALSE,
  file_names TEXT[],
  search_results JSONB,
  duration_ms INTEGER,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mimir_msg_conv_id ON mimir_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_mimir_msg_created ON mimir_messages(conversation_id, created_at);

-- Лог использования AI (для мониторинга расходов на API)
CREATE TABLE IF NOT EXISTS mimir_usage_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  conversation_id INTEGER REFERENCES mimir_conversations(id) ON DELETE SET NULL,
  provider VARCHAR(20) NOT NULL,
  model VARCHAR(100) NOT NULL,
  tokens_input INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  duration_ms INTEGER DEFAULT 0,
  success BOOLEAN DEFAULT TRUE,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_mimir_usage_created ON mimir_usage_log(created_at);
CREATE INDEX IF NOT EXISTS idx_mimir_usage_user ON mimir_usage_log(user_id);

-- Триггер для обновления updated_at
CREATE OR REPLACE FUNCTION update_mimir_conversation_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mimir_conversation_updated ON mimir_conversations;
CREATE TRIGGER trg_mimir_conversation_updated
  BEFORE UPDATE ON mimir_conversations
  FOR EACH ROW
  EXECUTE FUNCTION update_mimir_conversation_timestamp();

-- Дефолтные настройки AI в таблицу settings
INSERT INTO settings (key, value_json, updated_at) VALUES
  ('ai_provider', '"anthropic"', NOW()),
  ('ai_model', '"claude-sonnet-4-20250514"', NOW()),
  ('ai_max_tokens', '4096', NOW()),
  ('ai_temperature', '0.6', NOW())
ON CONFLICT (key) DO NOTHING;
