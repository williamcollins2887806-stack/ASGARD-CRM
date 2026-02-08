-- ============================================================
-- V018: Полная интеграция почты (Фаза 8, Шаг 5)
-- Требования: №52, №53, №54, №55, №56
-- ============================================================

-- 1. ПОЧТОВЫЕ АККАУНТЫ
CREATE TABLE IF NOT EXISTS email_accounts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  email_address VARCHAR(255) NOT NULL UNIQUE,
  account_type VARCHAR(50) DEFAULT 'primary',

  imap_host VARCHAR(255),
  imap_port INTEGER DEFAULT 993,
  imap_user VARCHAR(255),
  imap_pass_encrypted TEXT,
  imap_tls BOOLEAN DEFAULT true,
  imap_folder VARCHAR(255) DEFAULT 'INBOX',

  smtp_host VARCHAR(255),
  smtp_port INTEGER DEFAULT 587,
  smtp_user VARCHAR(255),
  smtp_pass_encrypted TEXT,
  smtp_tls BOOLEAN DEFAULT true,
  smtp_from_name VARCHAR(255) DEFAULT 'ООО «Асгард Сервис»',

  sync_enabled BOOLEAN DEFAULT true,
  sync_interval_sec INTEGER DEFAULT 120,
  sync_max_emails INTEGER DEFAULT 200,
  last_sync_at TIMESTAMP,
  last_sync_uid INTEGER DEFAULT 0,
  last_sync_error TEXT,

  is_active BOOLEAN DEFAULT true,
  is_copy_target BOOLEAN DEFAULT false,
  exclude_from_inbox BOOLEAN DEFAULT false,

  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. ПИСЬМА
CREATE TABLE IF NOT EXISTS emails (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES email_accounts(id) ON DELETE SET NULL,

  direction VARCHAR(10) NOT NULL DEFAULT 'inbound'
    CHECK (direction IN ('inbound', 'outbound')),
  message_id VARCHAR(998),
  in_reply_to VARCHAR(998),
  references_header TEXT,
  thread_id VARCHAR(255),

  from_email VARCHAR(255),
  from_name VARCHAR(255),
  to_emails JSONB DEFAULT '[]',
  cc_emails JSONB DEFAULT '[]',
  bcc_emails JSONB DEFAULT '[]',
  reply_to_email VARCHAR(255),

  subject TEXT,
  body_text TEXT,
  body_html TEXT,
  body_html_raw TEXT,
  snippet VARCHAR(300),

  email_type VARCHAR(50) DEFAULT 'unknown'
    CHECK (email_type IN ('direct_request','platform_tender','newsletter','internal','crm_outbound','unknown')),
  classification_confidence INTEGER DEFAULT 0,
  classification_rule_id INTEGER,

  is_read BOOLEAN DEFAULT false,
  is_starred BOOLEAN DEFAULT false,
  is_archived BOOLEAN DEFAULT false,
  is_deleted BOOLEAN DEFAULT false,
  is_spam BOOLEAN DEFAULT false,
  is_draft BOOLEAN DEFAULT false,

  linked_tender_id INTEGER,
  linked_work_id INTEGER,
  linked_customer_inn VARCHAR(20),
  linked_entities JSONB DEFAULT '{}',

  has_attachments BOOLEAN DEFAULT false,
  attachment_count INTEGER DEFAULT 0,
  total_attachments_size BIGINT DEFAULT 0,

  imap_uid INTEGER,
  imap_folder VARCHAR(255) DEFAULT 'INBOX',
  imap_flags TEXT,
  raw_headers TEXT,

  sent_by_user_id INTEGER,
  template_id INTEGER,
  reply_to_email_id INTEGER,
  forward_of_email_id INTEGER,

  ai_summary TEXT,
  ai_classification JSONB,
  ai_color VARCHAR(20),
  ai_recommendation TEXT,
  ai_processed_at TIMESTAMP,

  email_date TIMESTAMP NOT NULL DEFAULT NOW(),
  synced_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_emails_message_id_unique
  ON emails(message_id) WHERE message_id IS NOT NULL;

-- 3. ВЛОЖЕНИЯ
CREATE TABLE IF NOT EXISTS email_attachments (
  id SERIAL PRIMARY KEY,
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,

  filename VARCHAR(500) NOT NULL,
  original_filename VARCHAR(500),
  mime_type VARCHAR(255) DEFAULT 'application/octet-stream',
  size BIGINT DEFAULT 0,
  file_path TEXT NOT NULL,

  content_id VARCHAR(500),
  content_disposition VARCHAR(50),
  is_inline BOOLEAN DEFAULT false,

  checksum_sha256 VARCHAR(64),
  thumbnail_path TEXT,

  ai_content_type VARCHAR(100),
  ai_extracted_text TEXT,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_attachments_email ON email_attachments(email_id);

-- 4. ПРАВИЛА КЛАССИФИКАЦИИ
CREATE TABLE IF NOT EXISTS email_classification_rules (
  id SERIAL PRIMARY KEY,
  rule_type VARCHAR(50) NOT NULL
    CHECK (rule_type IN ('domain','keyword_subject','keyword_body','header','from_pattern','combined')),
  pattern VARCHAR(500) NOT NULL,
  match_mode VARCHAR(20) DEFAULT 'contains'
    CHECK (match_mode IN ('exact','contains','regex','starts_with','ends_with')),
  classification VARCHAR(50) NOT NULL
    CHECK (classification IN ('direct_request','platform_tender','newsletter','internal','spam')),
  confidence INTEGER DEFAULT 80 CHECK (confidence BETWEEN 0 AND 100),
  priority INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  description VARCHAR(500),
  times_matched INTEGER DEFAULT 0,
  last_matched_at TIMESTAMP,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 5. РАСШИРЕННЫЕ ШАБЛОНЫ
CREATE TABLE IF NOT EXISTS email_templates_v2 (
  id SERIAL PRIMARY KEY,
  code VARCHAR(100) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  category VARCHAR(100) DEFAULT 'custom'
    CHECK (category IN ('document','tender','notification','finance','hr','custom')),
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  variables_schema JSONB DEFAULT '[]',
  use_letterhead BOOLEAN DEFAULT false,
  default_cc TEXT,
  auto_attach_files JSONB DEFAULT '[]',
  is_system BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 6. ЛОГ СИНХРОНИЗАЦИИ
CREATE TABLE IF NOT EXISTS email_sync_log (
  id SERIAL PRIMARY KEY,
  account_id INTEGER REFERENCES email_accounts(id) ON DELETE CASCADE,
  sync_type VARCHAR(50) NOT NULL
    CHECK (sync_type IN ('initial','incremental','manual','idle_push')),
  status VARCHAR(50) NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','success','error','partial')),
  emails_fetched INTEGER DEFAULT 0,
  emails_new INTEGER DEFAULT 0,
  emails_updated INTEGER DEFAULT 0,
  attachments_saved INTEGER DEFAULT 0,
  errors_count INTEGER DEFAULT 0,
  error_details JSONB DEFAULT '[]',
  duration_ms INTEGER,
  started_at TIMESTAMP DEFAULT NOW(),
  completed_at TIMESTAMP
);

-- 7. ИНДЕКСЫ
CREATE INDEX IF NOT EXISTS idx_emails_direction ON emails(direction);
CREATE INDEX IF NOT EXISTS idx_emails_type ON emails(email_type);
CREATE INDEX IF NOT EXISTS idx_emails_unread ON emails(is_read) WHERE is_read = false AND is_deleted = false;
CREATE INDEX IF NOT EXISTS idx_emails_starred ON emails(is_starred) WHERE is_starred = true;
CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(email_date DESC);
CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_emails_from ON emails(from_email);
CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_id);
CREATE INDEX IF NOT EXISTS idx_emails_imap_uid ON emails(account_id, imap_uid);
CREATE INDEX IF NOT EXISTS idx_emails_list ON emails(direction, is_deleted, is_archived, email_date DESC);
CREATE INDEX IF NOT EXISTS idx_email_sync_log_account ON email_sync_log(account_id, started_at DESC);

-- 8. ПРАВИЛА КЛАССИФИКАЦИИ (начальные данные)
INSERT INTO email_classification_rules (rule_type, pattern, match_mode, classification, confidence, priority, description) VALUES
  ('domain', 'zakupki.gov.ru',     'contains', 'platform_tender', 95, 100, 'ЕИС Госзакупки'),
  ('domain', 'roseltorg.ru',       'contains', 'platform_tender', 95, 100, 'Росэлторг'),
  ('domain', 'b2b-center.ru',      'contains', 'platform_tender', 95, 100, 'B2B-Center'),
  ('domain', 'fabrikant.ru',       'contains', 'platform_tender', 95, 100, 'Фабрикант.ру'),
  ('domain', 'sberbank-ast.ru',    'contains', 'platform_tender', 95, 100, 'Сбербанк-АСТ'),
  ('domain', 'etp-gpb.ru',         'contains', 'platform_tender', 95, 100, 'ЭТП ГПБ'),
  ('domain', 'etpgaz.ru',          'contains', 'platform_tender', 95, 100, 'ЭТП Газпромбанк'),
  ('domain', 'lot-online.ru',      'contains', 'platform_tender', 95, 100, 'Lot-Online'),
  ('domain', 'rts-tender.ru',      'contains', 'platform_tender', 95, 100, 'РТС-Тендер'),
  ('domain', 'tektorg.ru',         'contains', 'platform_tender', 95, 100, 'ТЭК-Торг'),
  ('domain', 'onlinecontract.ru',  'contains', 'platform_tender', 95, 100, 'Онлайн-Контракт'),
  ('domain', 'astgoz.ru',          'contains', 'platform_tender', 95, 100, 'АСТ-ГОЗ'),
  ('domain', 'tender.mos.ru',      'contains', 'platform_tender', 95, 100, 'Портал поставщиков Москвы'),
  ('domain', 'etp.zakazrf.ru',     'contains', 'platform_tender', 95, 100, 'ЗаказРФ'),
  ('domain', 'purchaseprocess.ru', 'contains', 'platform_tender', 90, 100, 'Purchase Process'),
  ('domain', 'asgard-service.ru',  'contains', 'internal', 99, 200, 'Внутренние @asgard-service.ru'),
  ('domain', 'asgard-service.com', 'contains', 'internal', 99, 200, 'Внутренние @asgard-service.com'),
  ('keyword_subject', 'запрос на выполнение работ',   'contains', 'direct_request', 85, 50, 'Прямой запрос на работы'),
  ('keyword_subject', 'коммерческое предложение',     'contains', 'direct_request', 70, 50, 'Запрос КП'),
  ('keyword_subject', 'просим рассмотреть',           'contains', 'direct_request', 70, 50, 'Просьба рассмотреть'),
  ('keyword_subject', 'техническое задание',           'contains', 'direct_request', 75, 50, 'ТЗ во вложении'),
  ('keyword_subject', 'приглашаем к участию',          'contains', 'direct_request', 75, 50, 'Приглашение к участию'),
  ('keyword_subject', 'запрос котировок',       'contains', 'platform_tender', 80, 60, 'Запрос котировок'),
  ('keyword_subject', 'запрос предложений',     'contains', 'platform_tender', 80, 60, 'Запрос предложений'),
  ('keyword_subject', 'аукцион №',              'contains', 'platform_tender', 85, 60, 'Аукцион с номером'),
  ('keyword_subject', 'конкурс №',              'contains', 'platform_tender', 85, 60, 'Конкурс с номером'),
  ('keyword_subject', 'закупка №',              'contains', 'platform_tender', 85, 60, 'Закупка с номером'),
  ('keyword_subject', 'тендер №',               'contains', 'platform_tender', 85, 60, 'Тендер с номером'),
  ('keyword_subject', 'извещение о закупке',    'contains', 'platform_tender', 85, 60, 'Извещение'),
  ('header', 'List-Unsubscribe',  'contains', 'newsletter', 90, 30, 'Заголовок List-Unsubscribe'),
  ('header', 'Precedence: bulk',  'contains', 'newsletter', 90, 30, 'Заголовок Precedence: bulk'),
  ('header', 'Precedence: list',  'contains', 'newsletter', 85, 30, 'Заголовок Precedence: list')
ON CONFLICT DO NOTHING;

-- 9. ШАБЛОНЫ ПИСЕМ
INSERT INTO email_templates_v2 (code, name, category, subject_template, body_template, variables_schema, use_letterhead, is_system, sort_order) VALUES
  ('tender_accept', 'Принятие заявки в работу', 'tender',
   'Re: {original_subject}',
   '<p>Добрый день!</p><p>Благодарим за предоставленную информацию.</p><p>Сообщаем, что Ваша заявка принята в работу. Коммерческое предложение будет подготовлено и направлено в установленные сроки.</p><p>Контактное лицо: {contact_person}, тел. {contact_phone}.</p>',
   '[{"name":"original_subject","label":"Тема оригинального письма","type":"text","required":true},{"name":"contact_person","label":"Контактное лицо","type":"text","required":true},{"name":"contact_phone","label":"Телефон","type":"text","required":false}]',
   true, true, 20),
  ('tender_reject', 'Отказ от участия в тендере', 'tender',
   'Re: {original_subject}',
   '<p>Добрый день!</p><p>Благодарим за приглашение к участию в тендере.</p><p>К сожалению, в настоящее время мы не имеем возможности принять участие в данном конкурсе{reject_reason}.</p><p>Надеемся на дальнейшее сотрудничество.</p>',
   '[{"name":"original_subject","label":"Тема оригинального письма","type":"text","required":true},{"name":"reject_reason","label":"Причина отказа","type":"text","required":false}]',
   true, true, 21),
  ('payment_confirm', 'Подтверждение оплаты', 'finance',
   'Подтверждение оплаты по договору {contract_number}',
   '<p>Добрый день!</p><p>Настоящим подтверждаем получение оплаты по договору {contract_number}.</p><p>Сумма: <b>{amount} руб.</b></p><p>Дата зачисления: {payment_date}</p>',
   '[{"name":"contract_number","label":"№ договора","type":"text","required":true},{"name":"amount","label":"Сумма","type":"number","required":true},{"name":"payment_date","label":"Дата оплаты","type":"date","required":true}]',
   true, true, 30),
  ('work_completion', 'Уведомление о завершении работ', 'document',
   'Уведомление о завершении работ по договору {contract_number}',
   '<p>Добрый день!</p><p>Сообщаем о завершении работ по договору {contract_number}.</p><p>Объект: <b>{work_title}</b></p><p>Акт выполненных работ во вложении. Просим подписать и вернуть скан-копию в течение 5 рабочих дней.</p>',
   '[{"name":"contract_number","label":"№ договора","type":"text","required":true},{"name":"work_title","label":"Название объекта","type":"text","required":true}]',
   true, true, 31),
  ('general_official', 'Официальное письмо (на бланке)', 'custom',
   '{subject}',
   '{body}',
   '[{"name":"subject","label":"Тема","type":"text","required":true},{"name":"body","label":"Текст","type":"html","required":true}]',
   true, true, 100),
  ('general_plain', 'Простое письмо (без бланка)', 'custom',
   '{subject}',
   '{body}',
   '[{"name":"subject","label":"Тема","type":"text","required":true},{"name":"body","label":"Текст","type":"html","required":true}]',
   false, true, 101)
ON CONFLICT (code) DO NOTHING;
