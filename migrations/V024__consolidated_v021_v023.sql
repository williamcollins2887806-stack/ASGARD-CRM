-- ═══════════════════════════════════════════════════════════════════════════
-- V024: Consolidated migration (V021 + V022 + V023)
-- Integrations (Bank/1C, Platforms, ERP) + Webhook secret + Sites table
-- ═══════════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────────
-- РАЗДЕЛ 1: Банковские операции
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bank_transactions (
  id SERIAL PRIMARY KEY,
  import_hash VARCHAR(100) UNIQUE,
  external_id VARCHAR(255),
  batch_id INTEGER,
  transaction_date DATE NOT NULL,
  amount NUMERIC(15,2) NOT NULL,
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('income', 'expense')),
  currency VARCHAR(3) DEFAULT 'RUB',
  counterparty_name VARCHAR(500),
  counterparty_inn VARCHAR(20),
  counterparty_kpp VARCHAR(20),
  counterparty_account VARCHAR(30),
  counterparty_bank_bik VARCHAR(20),
  our_account VARCHAR(30),
  our_bank_bik VARCHAR(20),
  payment_purpose TEXT,
  description TEXT,
  document_number VARCHAR(50),
  document_date DATE,
  article VARCHAR(100),
  article_confidence VARCHAR(20) DEFAULT 'none'
    CHECK (article_confidence IN ('high', 'medium', 'low', 'none', 'manual')),
  category_1c VARCHAR(100),
  work_id INTEGER REFERENCES works(id),
  tender_id INTEGER REFERENCES tenders(id),
  linked_income_id INTEGER,
  linked_expense_id INTEGER,
  status VARCHAR(30) DEFAULT 'new'
    CHECK (status IN ('new', 'classified', 'confirmed', 'distributed', 'exported_1c', 'skipped')),
  source_format VARCHAR(30),
  source_filename VARCHAR(255),
  imported_by INTEGER REFERENCES users(id),
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_import_batches (
  id SERIAL PRIMARY KEY,
  filename VARCHAR(255),
  source_format VARCHAR(30),
  total_rows INTEGER DEFAULT 0,
  new_rows INTEGER DEFAULT 0,
  duplicate_rows INTEGER DEFAULT 0,
  auto_classified INTEGER DEFAULT 0,
  manual_needed INTEGER DEFAULT 0,
  status VARCHAR(30) DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'error')),
  imported_by INTEGER REFERENCES users(id),
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bank_classification_rules (
  id SERIAL PRIMARY KEY,
  pattern VARCHAR(255) NOT NULL,
  match_field VARCHAR(30) DEFAULT 'all'
    CHECK (match_field IN ('counterparty', 'purpose', 'document', 'all')),
  direction VARCHAR(10),
  article VARCHAR(100) NOT NULL,
  category_1c VARCHAR(100),
  work_id INTEGER,
  priority INTEGER DEFAULT 0,
  usage_count INTEGER DEFAULT 0,
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bank_tx_hash ON bank_transactions(import_hash);
CREATE INDEX IF NOT EXISTS idx_bank_tx_date ON bank_transactions(transaction_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_tx_status ON bank_transactions(status);
CREATE INDEX IF NOT EXISTS idx_bank_tx_batch ON bank_transactions(batch_id);
CREATE INDEX IF NOT EXISTS idx_bank_tx_article ON bank_transactions(article);
CREATE INDEX IF NOT EXISTS idx_bank_tx_counterparty ON bank_transactions(counterparty_inn);
CREATE INDEX IF NOT EXISTS idx_bank_rules_pattern ON bank_classification_rules(pattern);

-- Системные правила классификации
INSERT INTO bank_classification_rules (pattern, match_field, direction, article, category_1c, is_system, priority) VALUES
  ('зарплат',          'purpose', 'expense', 'fot', 'ОплатаТруда', true, 100),
  ('заработн',         'purpose', 'expense', 'fot', 'ОплатаТруда', true, 100),
  ('оклад',            'purpose', 'expense', 'fot', 'ОплатаТруда', true, 100),
  ('премия',           'purpose', 'expense', 'fot', 'ОплатаТруда', true, 90),
  ('аванс сотруд',     'purpose', 'expense', 'fot', 'ОплатаТруда', true, 90),
  ('ндфл',             'purpose', 'expense', 'taxes', 'Налоги', true, 100),
  ('ндс',              'purpose', 'expense', 'taxes', 'Налоги', true, 100),
  ('пфр',              'purpose', 'expense', 'taxes', 'Налоги', true, 100),
  ('фсс',              'purpose', 'expense', 'taxes', 'Налоги', true, 100),
  ('фомс',             'purpose', 'expense', 'taxes', 'Налоги', true, 100),
  ('ифнс',             'purpose', 'expense', 'taxes', 'Налоги', true, 100),
  ('аренда',           'purpose', 'expense', 'rent', 'АрендаПомещений', true, 90),
  ('арендн',           'purpose', 'expense', 'rent', 'АрендаПомещений', true, 90),
  ('доставк',          'purpose', 'expense', 'logistics', 'Логистика', true, 80),
  ('транспорт',        'purpose', 'expense', 'logistics', 'Логистика', true, 80),
  ('перевоз',          'purpose', 'expense', 'logistics', 'Логистика', true, 80),
  ('такси',            'purpose', 'expense', 'logistics', 'Логистика', true, 70),
  ('ржд',              'purpose', 'expense', 'logistics', 'Логистика', true, 80),
  ('авиабилет',        'purpose', 'expense', 'logistics', 'Логистика', true, 80),
  ('материал',         'purpose', 'expense', 'materials', 'Материалы', true, 80),
  ('запчаст',          'purpose', 'expense', 'materials', 'Материалы', true, 80),
  ('инструмент',       'purpose', 'expense', 'materials', 'Материалы', true, 80),
  ('субподряд',        'purpose', 'expense', 'subcontract', 'Субподряд', true, 90),
  ('подрядн',          'purpose', 'expense', 'subcontract', 'Субподряд', true, 80),
  ('комисси банк',     'purpose', 'expense', 'bank', 'БанковскиеКомиссии', true, 90),
  ('за ведение',       'purpose', 'expense', 'bank', 'БанковскиеКомиссии', true, 90),
  ('рко',              'purpose', 'expense', 'bank', 'БанковскиеКомиссии', true, 90),
  ('мтс',              'counterparty', 'expense', 'communication', 'Связь', true, 80),
  ('билайн',           'counterparty', 'expense', 'communication', 'Связь', true, 80),
  ('мегафон',          'counterparty', 'expense', 'communication', 'Связь', true, 80),
  ('ростелеком',       'counterparty', 'expense', 'communication', 'Связь', true, 80),
  ('оплата по договор','purpose', 'income', 'payment', 'ОплатаПоДоговорам', true, 80),
  ('по счет',          'purpose', 'income', 'payment', 'ОплатаПоДоговорам', true, 70),
  ('аванс',            'purpose', 'income', 'advance', 'АвансОтПокупателей', true, 70),
  ('предоплат',        'purpose', 'income', 'advance', 'АвансОтПокупателей', true, 70),
  ('возврат',          'purpose', 'income', 'refund', 'ВозвратСредств', true, 60)
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────
-- РАЗДЕЛ 2: Тендерные площадки — результаты парсинга
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_parse_results (
  id SERIAL PRIMARY KEY,
  email_id INTEGER REFERENCES emails(id),
  pre_tender_id INTEGER,
  platform_name VARCHAR(100),
  platform_code VARCHAR(50),
  purchase_number VARCHAR(100),
  purchase_url TEXT,
  lot_number VARCHAR(20),
  purchase_method VARCHAR(100),
  customer_name VARCHAR(500),
  customer_inn VARCHAR(20),
  object_description TEXT,
  nmck NUMERIC(15,2),
  currency VARCHAR(3) DEFAULT 'RUB',
  application_deadline TIMESTAMP,
  auction_date TIMESTAMP,
  work_start_date DATE,
  work_end_date DATE,
  docs_downloaded BOOLEAN DEFAULT false,
  docs_download_error TEXT,
  docs_paths JSONB DEFAULT '[]',
  ai_relevance_score INTEGER CHECK (ai_relevance_score IS NULL OR ai_relevance_score BETWEEN 0 AND 100),
  ai_analysis TEXT,
  ai_keywords JSONB DEFAULT '[]',
  parse_status VARCHAR(30) DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsing', 'parsed', 'docs_downloading', 'completed', 'failed', 'manual')),
  parse_error TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_parse_email ON platform_parse_results(email_id);
CREATE INDEX IF NOT EXISTS idx_platform_parse_status ON platform_parse_results(parse_status);
CREATE INDEX IF NOT EXISTS idx_platform_parse_platform ON platform_parse_results(platform_code);
CREATE INDEX IF NOT EXISTS idx_platform_parse_deadline ON platform_parse_results(application_deadline);
CREATE INDEX IF NOT EXISTS idx_platform_parse_number ON platform_parse_results(purchase_number);


-- ─────────────────────────────────────────────────────────────────────────
-- РАЗДЕЛ 3: ERP-интеграции (из V021 + webhook_secret из V022)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS erp_connections (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  erp_type VARCHAR(50) NOT NULL CHECK (erp_type IN ('1c', 'sap', 'galaxy', 'custom')),
  connection_url TEXT,
  auth_type VARCHAR(30) DEFAULT 'basic' CHECK (auth_type IN ('basic', 'token', 'oauth2', 'certificate')),
  auth_credentials_encrypted TEXT,
  webhook_secret VARCHAR(128),
  is_active BOOLEAN DEFAULT true,
  sync_direction VARCHAR(20) DEFAULT 'both' CHECK (sync_direction IN ('import', 'export', 'both')),
  last_sync_at TIMESTAMP,
  last_sync_status VARCHAR(30),
  last_sync_error TEXT,
  sync_interval_minutes INTEGER DEFAULT 60,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

COMMENT ON COLUMN erp_connections.webhook_secret IS 'HMAC-SHA256 secret for webhook signature validation';

CREATE TABLE IF NOT EXISTS erp_sync_log (
  id SERIAL PRIMARY KEY,
  connection_id INTEGER REFERENCES erp_connections(id),
  direction VARCHAR(10) NOT NULL CHECK (direction IN ('import', 'export')),
  entity_type VARCHAR(50) NOT NULL,
  records_total INTEGER DEFAULT 0,
  records_success INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  error_details JSONB DEFAULT '[]',
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP,
  status VARCHAR(30) DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed', 'cancelled')),
  initiated_by INTEGER REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS erp_field_mappings (
  id SERIAL PRIMARY KEY,
  connection_id INTEGER REFERENCES erp_connections(id),
  entity_type VARCHAR(50) NOT NULL,
  crm_field VARCHAR(100) NOT NULL,
  erp_field VARCHAR(100) NOT NULL,
  transform_rule VARCHAR(255),
  is_required BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_erp_sync_log_conn ON erp_sync_log(connection_id);
CREATE INDEX IF NOT EXISTS idx_erp_sync_log_date ON erp_sync_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_erp_field_map ON erp_field_mappings(connection_id, entity_type);


-- ─────────────────────────────────────────────────────────────────────────
-- РАЗДЕЛ 4: Регистрация модулей
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO modules (key, label, description, icon, sort_order, is_active) VALUES
  ('bank_integration', 'Банк/1С интеграция', 'Импорт выписок, классификация, экспорт в 1С', '🏦', 410, true),
  ('platforms', 'Тендерные площадки', 'Парсинг уведомлений с тендерных площадок', '🏗️', 420, true),
  ('erp', 'ERP-интеграции', 'Обмен данными с 1С, SAP, Галактика', '🔗', 430, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('ADMIN', 'bank_integration', true, true, true),
  ('BUH', 'bank_integration', true, true, false),
  ('DIRECTOR_GEN', 'bank_integration', true, true, true),
  ('DIRECTOR_COMM', 'bank_integration', true, false, false),
  ('DIRECTOR_DEV', 'bank_integration', true, false, false),
  ('ADMIN', 'platforms', true, true, true),
  ('DIRECTOR_GEN', 'platforms', true, true, true),
  ('DIRECTOR_COMM', 'platforms', true, true, false),
  ('DIRECTOR_DEV', 'platforms', true, true, false),
  ('HEAD_TO', 'platforms', true, true, false),
  ('TO', 'platforms', true, false, false),
  ('ADMIN', 'erp', true, true, true),
  ('DIRECTOR_GEN', 'erp', true, true, true)
ON CONFLICT DO NOTHING;

INSERT INTO user_permissions (user_id, module_key, can_read, can_write, can_delete)
SELECT u.id, rp.module_key, rp.can_read, rp.can_write, rp.can_delete
FROM users u
JOIN role_presets rp ON rp.role = u.role
WHERE rp.module_key IN ('bank_integration', 'platforms', 'erp')
  AND u.is_active = true
ON CONFLICT (user_id, module_key) DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────
-- РАЗДЕЛ 5: Sites — объекты/площадки на карте (из V023)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sites (
  id SERIAL PRIMARY KEY,
  name VARCHAR(500) NOT NULL,
  short_name VARCHAR(200),
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  region VARCHAR(200),
  site_type VARCHAR(50) DEFAULT 'object',
  customer_id INTEGER REFERENCES customers(id),
  customer_name VARCHAR(500),
  address TEXT,
  description TEXT,
  geocode_status VARCHAR(20) DEFAULT 'pending',
  geocode_source VARCHAR(200),
  photo_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sites_customer ON sites(customer_id);
CREATE INDEX IF NOT EXISTS idx_sites_geocode_status ON sites(geocode_status);
CREATE INDEX IF NOT EXISTS idx_sites_region ON sites(region);

ALTER TABLE works ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES sites(id);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS site_id INTEGER REFERENCES sites(id);
