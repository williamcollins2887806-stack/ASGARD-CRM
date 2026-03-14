-- V038: Персональные почтовые ящики сотрудников + папки
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Таблица персональных email-аккаунтов (привязка к пользователю)
CREATE TABLE IF NOT EXISTS user_email_accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email_address VARCHAR(255) NOT NULL,
  imap_host VARCHAR(255) DEFAULT 'imap.yandex.ru',
  imap_port INTEGER DEFAULT 993,
  imap_user VARCHAR(255),
  imap_pass_encrypted TEXT,
  imap_tls BOOLEAN DEFAULT true,
  smtp_host VARCHAR(255) DEFAULT 'smtp.yandex.ru',
  smtp_port INTEGER DEFAULT 465,
  smtp_user VARCHAR(255),
  smtp_pass_encrypted TEXT,
  smtp_tls BOOLEAN DEFAULT true,
  display_name VARCHAR(255),
  signature_html TEXT,
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMP,
  last_sync_uid INTEGER DEFAULT 0,
  last_sync_error TEXT,
  sync_interval_sec INTEGER DEFAULT 120,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, email_address)
);

CREATE INDEX IF NOT EXISTS idx_user_email_accounts_user ON user_email_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_user_email_accounts_active ON user_email_accounts(is_active) WHERE is_active = true;

-- 2. Таблица папок (как в IMAP)
CREATE TABLE IF NOT EXISTS email_folders (
  id SERIAL PRIMARY KEY,
  user_account_id INTEGER REFERENCES user_email_accounts(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES email_accounts(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  imap_path VARCHAR(255),
  folder_type VARCHAR(50) DEFAULT 'custom',
  unread_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  color VARCHAR(20),
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_folders_user_account ON email_folders(user_account_id);
CREATE INDEX IF NOT EXISTS idx_email_folders_account ON email_folders(account_id);

-- 3. Расширение таблицы emails
ALTER TABLE emails ADD COLUMN IF NOT EXISTS user_account_id INTEGER REFERENCES user_email_accounts(id);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS owner_user_id INTEGER REFERENCES users(id);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS folder_id INTEGER REFERENCES email_folders(id);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS is_crm_copy BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_emails_owner ON emails(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_emails_user_account ON emails(user_account_id);
CREATE INDEX IF NOT EXISTS idx_emails_folder ON emails(folder_id);

-- 4. Настройки Яндекс 360 (хранятся в settings)
INSERT INTO settings (key, value_json, updated_at)
VALUES ('yandex360_config', '{}', NOW())
ON CONFLICT (key) DO NOTHING;

