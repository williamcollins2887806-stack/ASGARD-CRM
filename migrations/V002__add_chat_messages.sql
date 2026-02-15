-- ASGARD CRM - Add chat_messages table
-- ═══════════════════════════════════════════════════════════════════════════

-- Chat messages table
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  chat_type VARCHAR(50) DEFAULT 'general',
  entity_id INTEGER,
  entity_title VARCHAR(255),
  chat_id INTEGER,
  to_user_id INTEGER REFERENCES users(id),
  user_id INTEGER REFERENCES users(id),
  user_name VARCHAR(255),
  user_role VARCHAR(50),
  text TEXT,
  attachments TEXT,
  mentions TEXT,
  is_system BOOLEAN DEFAULT false,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat_type ON chat_messages(chat_type);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user_id ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_to_user_id ON chat_messages(to_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_entity_id ON chat_messages(entity_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);

-- Chats table (for direct messages and group chats metadata)
CREATE TABLE IF NOT EXISTS chats (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  chat_type VARCHAR(50) DEFAULT 'direct',
  participants TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
