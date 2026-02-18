-- =====================================================================================
-- ASGARD CRM -- Initial Schema
-- V001__initial_schema.sql
--
-- Complete CREATE TABLE IF NOT EXISTS statements inferred from all src/routes/*.js files.
--
-- EXCLUDES tables handled by ensureTables() in src/index.js:
--   chat_messages, chats, chat_group_members, chat_attachments,
--   cash_requests, cash_expenses, cash_returns, cash_messages,
--   staff_plan, push_subscriptions, webauthn_credentials, webauthn_challenges
--
-- EXCLUDES tables from V031 migration:
--   tkp, pass_requests, tmc_requests
--
-- Tables are ordered so that referenced tables are created before referencing tables.
-- =====================================================================================

-- =========================================================================
-- TIER 0: Foundation tables (no foreign keys)
-- =========================================================================

-- 1. users (auth.js, users.js)
CREATE TABLE IF NOT EXISTS users (
  id                    SERIAL PRIMARY KEY,
  login                 VARCHAR(255) NOT NULL UNIQUE,
  password_hash         VARCHAR(255) NOT NULL,
  pin_hash              VARCHAR(255),
  name                  VARCHAR(255) NOT NULL,
  email                 VARCHAR(255),
  phone                 VARCHAR(255),
  role                  VARCHAR(50) NOT NULL DEFAULT 'PENDING',
  birth_date            DATE,
  employment_date       DATE,
  telegram_chat_id      VARCHAR(255),
  is_active             BOOLEAN NOT NULL DEFAULT false,
  must_change_password  BOOLEAN DEFAULT false,
  temp_password_hash    VARCHAR(255),
  temp_password_expires TIMESTAMP,
  last_login_at         TIMESTAMP,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP
);

-- 1b. staff (data.js, index.js ensureTables ALTER)
CREATE TABLE IF NOT EXISTS staff (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255),
  position VARCHAR(255),
  department VARCHAR(255),
  phone VARCHAR(50),
  email VARCHAR(255),
  user_id INTEGER,
  role_tag VARCHAR(50),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 2. settings (settings.js, email.js)
CREATE TABLE IF NOT EXISTS settings (
  key        VARCHAR(255) PRIMARY KEY,
  value_json TEXT,
  updated_at TIMESTAMP
);

-- 3. modules (permissions.js)
CREATE TABLE IF NOT EXISTS modules (
  id         SERIAL PRIMARY KEY,
  key        VARCHAR(255) NOT NULL UNIQUE,
  name       VARCHAR(255),
  is_active  BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0
);

-- 4. customers (customers.js, integrations.js)
CREATE TABLE IF NOT EXISTS customers (
  inn            VARCHAR(12) PRIMARY KEY,
  name           VARCHAR(255) NOT NULL,
  full_name      VARCHAR(500),
  kpp            VARCHAR(20),
  ogrn           VARCHAR(20),
  address        TEXT,
  phone          VARCHAR(255),
  email          VARCHAR(255),
  contact_person VARCHAR(255),
  bank_account   VARCHAR(50),
  bank_name      VARCHAR(255),
  bik            VARCHAR(20),
  notes          TEXT,
  category       VARCHAR(100),
  is_active      BOOLEAN DEFAULT true,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP
);

-- 5. equipment_categories (equipment.js)
CREATE TABLE IF NOT EXISTS equipment_categories (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(255),
  icon                 VARCHAR(100),
  sort_order           INTEGER,
  code                 VARCHAR(50),
  is_consumable        BOOLEAN DEFAULT false,
  requires_calibration BOOLEAN DEFAULT false
);

-- 6. objects (equipment.js)
CREATE TABLE IF NOT EXISTS objects (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(500),
  is_active BOOLEAN DEFAULT true
);

-- 7. permit_types (permits.js)
CREATE TABLE IF NOT EXISTS permit_types (
  id              SERIAL PRIMARY KEY,
  code            VARCHAR(50),
  name            VARCHAR(255),
  category        VARCHAR(100),
  validity_months INTEGER,
  sort_order      INTEGER,
  is_active       BOOLEAN DEFAULT true,
  is_system       BOOLEAN DEFAULT false,
  created_by      INTEGER REFERENCES users(id),
  updated_at      TIMESTAMP
);


-- =========================================================================
-- TIER 1: Tables referencing only users or other Tier 0 tables
-- =========================================================================

-- 8. user_requests (auth.js)
CREATE TABLE IF NOT EXISTS user_requests (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  status     VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 9. user_permissions (permissions.js)
CREATE TABLE IF NOT EXISTS user_permissions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  module_key VARCHAR(255) NOT NULL,
  can_read   BOOLEAN DEFAULT false,
  can_write  BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  granted_by INTEGER REFERENCES users(id),
  UNIQUE (user_id, module_key)
);

-- 10. role_presets (permissions.js)
CREATE TABLE IF NOT EXISTS role_presets (
  id         SERIAL PRIMARY KEY,
  role       VARCHAR(50) NOT NULL,
  module_key VARCHAR(255) NOT NULL,
  can_read   BOOLEAN DEFAULT false,
  can_write  BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  UNIQUE (role, module_key)
);

-- 11. user_menu_settings (permissions.js)
CREATE TABLE IF NOT EXISTS user_menu_settings (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id),
  hidden_routes JSONB DEFAULT '[]',
  route_order   JSONB DEFAULT '[]',
  updated_at    TIMESTAMP
);

-- 12. notifications (notifications.js, pre_tenders.js)
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  title      VARCHAR(500),
  message    TEXT,
  type       VARCHAR(100),
  link       VARCHAR(500),
  entity_id  INTEGER,
  is_read    BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 13. sites (sites.js)
CREATE TABLE IF NOT EXISTS sites (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(500) NOT NULL,
  short_name     VARCHAR(255),
  lat            NUMERIC,
  lng            NUMERIC,
  region         VARCHAR(255),
  site_type      VARCHAR(100) DEFAULT 'object',
  customer_id    VARCHAR(12),
  customer_name  VARCHAR(500),
  address        TEXT,
  description    TEXT,
  geocode_status VARCHAR(50) DEFAULT 'pending',
  photo_url      VARCHAR(1000),
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);

-- 14. tenders (tenders.js, pre_tenders.js)
CREATE TABLE IF NOT EXISTS tenders (
  id                SERIAL PRIMARY KEY,
  customer_name     VARCHAR(500),
  customer_inn      VARCHAR(12),
  tender_title      VARCHAR(500),
  tender_type       VARCHAR(100),
  tender_status     VARCHAR(100) DEFAULT 'Новый',
  period            VARCHAR(10),
  docs_deadline     DATE,
  tender_price      NUMERIC,
  responsible_pm_id INTEGER REFERENCES users(id),
  group_tag         VARCHAR(255),
  purchase_url      VARCHAR(1000),
  comment_to        TEXT,
  comment_dir       TEXT,
  reject_reason     TEXT,
  site_id           INTEGER REFERENCES sites(id),
  handoff_at        TIMESTAMP,
  created_by        INTEGER REFERENCES users(id),
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP
);

-- 15. audit_log (tenders.js, pre_tenders.js)
CREATE TABLE IF NOT EXISTS audit_log (
  id            SERIAL PRIMARY KEY,
  actor_user_id INTEGER REFERENCES users(id),
  entity_type   VARCHAR(100),
  entity_id     INTEGER,
  action        VARCHAR(100),
  details       TEXT,
  payload_json  JSONB,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- 16. employees (staff.js, payroll.js)
CREATE TABLE IF NOT EXISTS employees (
  id              SERIAL PRIMARY KEY,
  fio             VARCHAR(500),
  full_name       VARCHAR(500),
  role_tag        VARCHAR(100),
  phone           VARCHAR(50),
  email           VARCHAR(255),
  position        VARCHAR(255),
  passport_number VARCHAR(50),
  rating_avg      NUMERIC,
  is_active       BOOLEAN DEFAULT true,
  user_id         INTEGER REFERENCES users(id),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP
);

-- 17. warehouses (equipment.js)
CREATE TABLE IF NOT EXISTS warehouses (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(255),
  responsible_id INTEGER REFERENCES users(id),
  is_active      BOOLEAN DEFAULT true,
  is_main        BOOLEAN DEFAULT false
);

-- 18. email_accounts (mailbox.js)
CREATE TABLE IF NOT EXISTS email_accounts (
  id                  SERIAL PRIMARY KEY,
  name                VARCHAR(255),
  email_address       VARCHAR(255),
  account_type        VARCHAR(50) DEFAULT 'primary',
  imap_host           VARCHAR(255),
  imap_port           INTEGER DEFAULT 993,
  imap_user           VARCHAR(255),
  imap_pass_encrypted TEXT,
  imap_tls            BOOLEAN DEFAULT true,
  imap_folder         VARCHAR(100) DEFAULT 'INBOX',
  smtp_host           VARCHAR(255),
  smtp_port           INTEGER DEFAULT 587,
  smtp_user           VARCHAR(255),
  smtp_pass_encrypted TEXT,
  smtp_tls            BOOLEAN DEFAULT true,
  smtp_from_name      VARCHAR(255),
  sync_enabled        BOOLEAN DEFAULT true,
  sync_interval_sec   INTEGER DEFAULT 120,
  sync_max_emails     INTEGER DEFAULT 200,
  last_sync_at        TIMESTAMP,
  last_sync_uid       INTEGER,
  last_sync_error     TEXT,
  is_active           BOOLEAN DEFAULT true,
  is_copy_target      BOOLEAN DEFAULT false,
  exclude_from_inbox  BOOLEAN DEFAULT false,
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP
);

-- 19. saved_reports (reports.js)
CREATE TABLE IF NOT EXISTS saved_reports (
  id          SERIAL PRIMARY KEY,
  type        VARCHAR(50),
  period      VARCHAR(100),
  period_code VARCHAR(50) UNIQUE,
  data        JSONB,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 20. email_log (email.js)
CREATE TABLE IF NOT EXISTS email_log (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  to_email   VARCHAR(255),
  subject    VARCHAR(500),
  status     VARCHAR(50),
  message_id VARCHAR(500),
  error      TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 21. seals (data.js)
CREATE TABLE IF NOT EXISTS seals (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);


-- =========================================================================
-- TIER 2: Tables referencing Tier 1 tables
-- =========================================================================

-- 22. works (works.js)
CREATE TABLE IF NOT EXISTS works (
  id            SERIAL PRIMARY KEY,
  tender_id     INTEGER REFERENCES tenders(id),
  pm_id         INTEGER REFERENCES users(id),
  work_number   VARCHAR(100),
  work_title    VARCHAR(500),
  work_status   VARCHAR(100),
  contract_sum  NUMERIC,
  customer_name VARCHAR(500),
  start_date    DATE,
  start_plan    DATE,
  end_date_plan DATE,
  end_fact      DATE,
  site_id       INTEGER REFERENCES sites(id),
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP
);

-- 23. estimates (estimates.js)
CREATE TABLE IF NOT EXISTS estimates (
  id              SERIAL PRIMARY KEY,
  tender_id       INTEGER REFERENCES tenders(id),
  title           VARCHAR(500),
  pm_id           INTEGER REFERENCES users(id),
  approval_status VARCHAR(50),
  margin          NUMERIC,
  comment         TEXT,
  amount          NUMERIC,
  cost            NUMERIC,
  notes           TEXT,
  description     TEXT,
  customer        VARCHAR(500),
  object_name     VARCHAR(500),
  work_type       VARCHAR(255),
  priority        VARCHAR(50),
  deadline        DATE,
  items_json      JSONB,
  status          VARCHAR(50),
  work_id         INTEGER,
  created_by      INTEGER REFERENCES users(id),
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP
);

-- 24. documents (files.js, inbox_applications_ai.js)
CREATE TABLE IF NOT EXISTS documents (
  id            SERIAL PRIMARY KEY,
  filename      VARCHAR(500),
  original_name VARCHAR(500),
  mime_type     VARCHAR(255),
  size          INTEGER,
  type          VARCHAR(100),
  tender_id     INTEGER REFERENCES tenders(id),
  work_id       INTEGER,
  uploaded_by   INTEGER REFERENCES users(id),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- 25. emails (mailbox.js)
CREATE TABLE IF NOT EXISTS emails (
  id                        SERIAL PRIMARY KEY,
  account_id                INTEGER REFERENCES email_accounts(id),
  direction                 VARCHAR(20),
  message_id                VARCHAR(500),
  in_reply_to               VARCHAR(500),
  references_header         TEXT,
  thread_id                 VARCHAR(500),
  from_email                VARCHAR(255),
  from_name                 VARCHAR(500),
  to_emails                 JSONB,
  cc_emails                 JSONB,
  subject                   VARCHAR(1000),
  body_text                 TEXT,
  body_html                 TEXT,
  snippet                   VARCHAR(500),
  raw_headers               TEXT,
  email_type                VARCHAR(100),
  classification_confidence NUMERIC,
  classification_rule_id    INTEGER,
  is_read                   BOOLEAN DEFAULT false,
  is_starred                BOOLEAN DEFAULT false,
  is_archived               BOOLEAN DEFAULT false,
  is_deleted                BOOLEAN DEFAULT false,
  is_spam                   BOOLEAN DEFAULT false,
  is_draft                  BOOLEAN DEFAULT false,
  has_attachments           BOOLEAN DEFAULT false,
  attachment_count          INTEGER DEFAULT 0,
  linked_tender_id          INTEGER,
  linked_work_id            INTEGER,
  sent_by_user_id           INTEGER REFERENCES users(id),
  template_id               INTEGER,
  reply_to_email_id         INTEGER,
  forward_of_email_id       INTEGER,
  imap_folder               VARCHAR(100),
  ai_processed_at           TIMESTAMP,
  ai_color                  VARCHAR(50),
  ai_summary                TEXT,
  ai_classification         VARCHAR(100),
  ai_recommendation         TEXT,
  email_date                TIMESTAMP,
  created_at                TIMESTAMP DEFAULT NOW(),
  updated_at                TIMESTAMP
);

-- 26. email_attachments (mailbox.js)
CREATE TABLE IF NOT EXISTS email_attachments (
  id                SERIAL PRIMARY KEY,
  email_id          INTEGER REFERENCES emails(id),
  filename          VARCHAR(500),
  original_filename VARCHAR(500),
  mime_type         VARCHAR(255),
  size              INTEGER,
  file_path         VARCHAR(1000),
  content_id        VARCHAR(500),
  is_inline         BOOLEAN DEFAULT false
);

-- 27. email_sync_log (mailbox.js)
CREATE TABLE IF NOT EXISTS email_sync_log (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER REFERENCES email_accounts(id),
  started_at   TIMESTAMP,
  completed_at TIMESTAMP,
  status       VARCHAR(50),
  new_emails   INTEGER,
  error        TEXT
);

-- 28. email_templates_v2 (mailbox.js)
CREATE TABLE IF NOT EXISTS email_templates_v2 (
  id                SERIAL PRIMARY KEY,
  code              VARCHAR(100),
  name              VARCHAR(255),
  category          VARCHAR(100),
  subject_template  TEXT,
  body_template     TEXT,
  variables_schema  JSONB,
  use_letterhead    BOOLEAN DEFAULT false,
  default_cc        VARCHAR(500),
  auto_attach_files JSONB,
  is_system         BOOLEAN DEFAULT false,
  is_active         BOOLEAN DEFAULT true,
  sort_order        INTEGER DEFAULT 0,
  created_by        INTEGER REFERENCES users(id),
  created_at        TIMESTAMP DEFAULT NOW(),
  updated_at        TIMESTAMP
);

-- 29. email_classification_rules (mailbox.js)
CREATE TABLE IF NOT EXISTS email_classification_rules (
  id             SERIAL PRIMARY KEY,
  rule_type      VARCHAR(100),
  pattern        VARCHAR(500),
  match_mode     VARCHAR(50) DEFAULT 'contains',
  classification VARCHAR(100),
  confidence     INTEGER DEFAULT 80,
  priority       INTEGER DEFAULT 0,
  is_active      BOOLEAN DEFAULT true,
  description    TEXT,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP
);

-- 30. calendar_events (calendar.js)
CREATE TABLE IF NOT EXISTS calendar_events (
  id          SERIAL PRIMARY KEY,
  title       VARCHAR(500),
  description TEXT,
  date        DATE,
  end_date    DATE,
  created_by  INTEGER REFERENCES users(id),
  type        VARCHAR(100),
  time        VARCHAR(20),
  location    VARCHAR(500),
  color       VARCHAR(50),
  tender_id   INTEGER REFERENCES tenders(id),
  work_id     INTEGER,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP
);

-- 31. employee_reviews (staff.js)
CREATE TABLE IF NOT EXISTS employee_reviews (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  rating      INTEGER,
  score_1_10  INTEGER,
  comment     TEXT,
  pm_id       INTEGER REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 32. employee_permits (permits.js)
CREATE TABLE IF NOT EXISTS employee_permits (
  id                  SERIAL PRIMARY KEY,
  employee_id         INTEGER REFERENCES employees(id),
  type_id             INTEGER REFERENCES permit_types(id),
  category            VARCHAR(100),
  doc_number          VARCHAR(100),
  issuer              VARCHAR(500),
  issue_date          DATE,
  expiry_date         DATE,
  scan_file           VARCHAR(500),
  scan_original_name  VARCHAR(500),
  file_url            VARCHAR(1000),
  notes               TEXT,
  is_active           BOOLEAN DEFAULT true,
  created_by          INTEGER REFERENCES users(id),
  renewal_of          INTEGER,
  notify_30_sent      BOOLEAN DEFAULT false,
  notify_14_sent      BOOLEAN DEFAULT false,
  notify_expired_sent BOOLEAN DEFAULT false,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP
);

-- 33. permit_applications (permit_applications.js)
CREATE TABLE IF NOT EXISTS permit_applications (
  id               SERIAL PRIMARY KEY,
  number           VARCHAR(100),
  title            VARCHAR(500),
  contractor_name  VARCHAR(500),
  contractor_email VARCHAR(255),
  cover_letter     TEXT,
  status           VARCHAR(50),
  created_by       INTEGER REFERENCES users(id),
  sent_by          INTEGER REFERENCES users(id),
  sent_at          TIMESTAMP,
  email_message_id VARCHAR(500),
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP
);

-- 34. seal_transfers (data.js)
CREATE TABLE IF NOT EXISTS seal_transfers (
  id         SERIAL PRIMARY KEY,
  seal_id    INTEGER REFERENCES seals(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 35. employee_rates (payroll.js)
CREATE TABLE IF NOT EXISTS employee_rates (
  id             SERIAL PRIMARY KEY,
  employee_id    INTEGER REFERENCES employees(id),
  role_tag       VARCHAR(100),
  day_rate       NUMERIC,
  shift_rate     NUMERIC,
  overtime_rate  NUMERIC,
  effective_from DATE,
  effective_to   DATE,
  comment        TEXT,
  created_by     INTEGER REFERENCES users(id)
);

-- 36. self_employed (payroll.js)
CREATE TABLE IF NOT EXISTS self_employed (
  id                SERIAL PRIMARY KEY,
  employee_id       INTEGER REFERENCES employees(id),
  full_name         VARCHAR(500),
  inn               VARCHAR(12),
  phone             VARCHAR(50),
  email             VARCHAR(255),
  bank_name         VARCHAR(255),
  bik               VARCHAR(20),
  corr_account      VARCHAR(50),
  account_number    VARCHAR(50),
  card_number       VARCHAR(50),
  npd_status        VARCHAR(50),
  npd_registered_at DATE,
  contract_number   VARCHAR(100),
  contract_date     DATE,
  contract_end_date DATE,
  comment           TEXT,
  is_active         BOOLEAN DEFAULT true,
  updated_at        TIMESTAMP
);

-- 37. mimir_conversations (mimir.js)
CREATE TABLE IF NOT EXISTS mimir_conversations (
  id                   SERIAL PRIMARY KEY,
  user_id              INTEGER REFERENCES users(id),
  title                VARCHAR(500) DEFAULT 'Новый диалог',
  is_pinned            BOOLEAN DEFAULT false,
  is_archived          BOOLEAN DEFAULT false,
  message_count        INTEGER DEFAULT 0,
  total_tokens         INTEGER DEFAULT 0,
  last_message_at      TIMESTAMP,
  last_message_preview VARCHAR(500),
  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP DEFAULT NOW()
);


-- =========================================================================
-- TIER 3: Tables referencing Tier 2 tables (works, emails, etc.)
-- =========================================================================

-- 38. work_expenses (expenses.js)
CREATE TABLE IF NOT EXISTS work_expenses (
  id          SERIAL PRIMARY KEY,
  work_id     INTEGER REFERENCES works(id) ON DELETE CASCADE,
  category    VARCHAR(255),
  description TEXT,
  amount      NUMERIC,
  date        DATE,
  receipt_url VARCHAR(1000),
  supplier    VARCHAR(500),
  notes       TEXT,
  status      VARCHAR(50),
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP
);

-- 39. office_expenses (expenses.js)
CREATE TABLE IF NOT EXISTS office_expenses (
  id          SERIAL PRIMARY KEY,
  category    VARCHAR(255),
  description TEXT,
  amount      NUMERIC,
  date        DATE,
  receipt_url VARCHAR(1000),
  supplier    VARCHAR(500),
  notes       TEXT,
  status      VARCHAR(50),
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP
);

-- 40. incomes (incomes.js)
CREATE TABLE IF NOT EXISTS incomes (
  id          SERIAL PRIMARY KEY,
  work_id     INTEGER REFERENCES works(id) ON DELETE CASCADE,
  amount      NUMERIC,
  date        DATE,
  description TEXT,
  type        VARCHAR(100),
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP
);

-- 41. acts (acts.js)
CREATE TABLE IF NOT EXISTS acts (
  id            SERIAL PRIMARY KEY,
  act_number    VARCHAR(100),
  act_date      DATE,
  status        VARCHAR(50) DEFAULT 'draft',
  work_id       INTEGER REFERENCES works(id),
  customer_name VARCHAR(500),
  customer_inn  VARCHAR(12),
  description   TEXT,
  amount        NUMERIC,
  vat_pct       INTEGER DEFAULT 22,
  total_amount  NUMERIC,
  signed_date   DATE,
  paid_date     DATE,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP
);

-- 42. invoices (invoices.js)
CREATE TABLE IF NOT EXISTS invoices (
  id             SERIAL PRIMARY KEY,
  invoice_number VARCHAR(100),
  invoice_date   DATE,
  invoice_type   VARCHAR(100),
  status         VARCHAR(50),
  work_id        INTEGER REFERENCES works(id),
  act_id         INTEGER REFERENCES acts(id),
  customer_name  VARCHAR(500),
  customer_inn   VARCHAR(12),
  description    TEXT,
  amount         NUMERIC,
  vat_pct        INTEGER DEFAULT 22,
  total_amount   NUMERIC,
  due_date       DATE,
  paid_amount    NUMERIC DEFAULT 0,
  created_by     INTEGER REFERENCES users(id),
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP
);

-- 43. invoice_payments (invoices.js)
CREATE TABLE IF NOT EXISTS invoice_payments (
  id           SERIAL PRIMARY KEY,
  invoice_id   INTEGER REFERENCES invoices(id),
  amount       NUMERIC,
  payment_date DATE,
  comment      TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMP DEFAULT NOW()
);

-- 44. employee_plan (staff.js)
CREATE TABLE IF NOT EXISTS employee_plan (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  date        DATE,
  work_id     INTEGER REFERENCES works(id),
  note        TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 45. employee_assignments (works.js -- referenced in DELETE CASCADE)
CREATE TABLE IF NOT EXISTS employee_assignments (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  work_id     INTEGER REFERENCES works(id) ON DELETE CASCADE,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 46. work_permit_requirements (permits.js)
CREATE TABLE IF NOT EXISTS work_permit_requirements (
  id             SERIAL PRIMARY KEY,
  work_id        INTEGER REFERENCES works(id),
  permit_type_id INTEGER REFERENCES permit_types(id),
  is_mandatory   BOOLEAN DEFAULT true,
  notes          TEXT,
  created_at     TIMESTAMP DEFAULT NOW()
);

-- 47. permit_application_items (permit_applications.js)
CREATE TABLE IF NOT EXISTS permit_application_items (
  id              SERIAL PRIMARY KEY,
  application_id  INTEGER REFERENCES permit_applications(id),
  employee_id     INTEGER REFERENCES employees(id),
  permit_type_ids INTEGER[],
  notes           TEXT
);

-- 48. permit_application_history (permit_applications.js)
CREATE TABLE IF NOT EXISTS permit_application_history (
  id             SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES permit_applications(id),
  old_status     VARCHAR(50),
  new_status     VARCHAR(50),
  changed_by     INTEGER REFERENCES users(id),
  comment        TEXT,
  created_at     TIMESTAMP DEFAULT NOW()
);

-- 49. tasks (tasks.js)
CREATE TABLE IF NOT EXISTS tasks (
  id               SERIAL PRIMARY KEY,
  creator_id       INTEGER REFERENCES users(id),
  assignee_id      INTEGER REFERENCES users(id),
  title            VARCHAR(500),
  description      TEXT,
  deadline         TIMESTAMP,
  priority         VARCHAR(50),
  creator_comment  TEXT,
  assignee_comment TEXT,
  status           VARCHAR(50),
  files            JSONB,
  work_id          INTEGER REFERENCES works(id),
  tender_id        INTEGER REFERENCES tenders(id),
  kanban_column    VARCHAR(100),
  kanban_position  INTEGER,
  accepted_at      TIMESTAMP,
  completed_at     TIMESTAMP,
  acknowledged_at  TIMESTAMP,
  acknowledged_by  INTEGER REFERENCES users(id),
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP
);

-- 50. todo_items (tasks.js)
CREATE TABLE IF NOT EXISTS todo_items (
  id                SERIAL PRIMARY KEY,
  user_id           INTEGER REFERENCES users(id),
  text              TEXT,
  sort_order        INTEGER,
  done              BOOLEAN DEFAULT false,
  done_at           TIMESTAMP,
  auto_delete_hours INTEGER,
  created_at        TIMESTAMP DEFAULT NOW()
);

-- 51. task_comments (tasks.js)
CREATE TABLE IF NOT EXISTS task_comments (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER REFERENCES tasks(id),
  user_id    INTEGER REFERENCES users(id),
  text       TEXT,
  is_system  BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 52. task_watchers (tasks.js)
CREATE TABLE IF NOT EXISTS task_watchers (
  task_id    INTEGER REFERENCES tasks(id),
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (task_id, user_id)
);

-- 53. meetings (meetings.js)
CREATE TABLE IF NOT EXISTS meetings (
  id                    SERIAL PRIMARY KEY,
  organizer_id          INTEGER REFERENCES users(id),
  title                 VARCHAR(500),
  description           TEXT,
  location              VARCHAR(500),
  start_time            TIMESTAMP,
  end_time              TIMESTAMP,
  agenda                TEXT,
  work_id               INTEGER REFERENCES works(id),
  tender_id             INTEGER REFERENCES tenders(id),
  notify_before_minutes INTEGER,
  status                VARCHAR(50),
  minutes               TEXT,
  minutes_author_id     INTEGER REFERENCES users(id),
  minutes_approved_at   TIMESTAMP,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP
);

-- 54. meeting_participants (meetings.js)
CREATE TABLE IF NOT EXISTS meeting_participants (
  meeting_id       INTEGER REFERENCES meetings(id),
  user_id          INTEGER REFERENCES users(id),
  rsvp_status      VARCHAR(50),
  rsvp_comment     TEXT,
  attended         BOOLEAN,
  reminder_sent_at TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW(),
  UNIQUE (meeting_id, user_id)
);

-- 55. payroll_sheets (payroll.js)
CREATE TABLE IF NOT EXISTS payroll_sheets (
  id                 SERIAL PRIMARY KEY,
  work_id            INTEGER REFERENCES works(id),
  title              VARCHAR(500),
  period_from        DATE,
  period_to          DATE,
  comment            TEXT,
  created_by         INTEGER REFERENCES users(id),
  status             VARCHAR(50),
  total_accrued      NUMERIC,
  total_bonus        NUMERIC,
  total_penalty      NUMERIC,
  total_advance_paid NUMERIC,
  total_payout       NUMERIC,
  workers_count      INTEGER,
  approved_by        INTEGER REFERENCES users(id),
  approved_at        TIMESTAMP,
  paid_by            INTEGER REFERENCES users(id),
  paid_at            TIMESTAMP,
  director_comment   TEXT,
  created_at         TIMESTAMP DEFAULT NOW(),
  updated_at         TIMESTAMP
);

-- 56. equipment (equipment.js)
CREATE TABLE IF NOT EXISTS equipment (
  id                        SERIAL PRIMARY KEY,
  inventory_number          VARCHAR(100),
  name                      VARCHAR(500),
  category_id               INTEGER REFERENCES equipment_categories(id),
  serial_number             VARCHAR(255),
  barcode                   VARCHAR(255),
  qr_code                   TEXT,
  qr_uuid                   UUID,
  purchase_price            NUMERIC,
  purchase_date             DATE,
  invoice_id                INTEGER,
  quantity                  INTEGER DEFAULT 1,
  unit                      VARCHAR(50) DEFAULT 'шт',
  warranty_end              DATE,
  maintenance_interval_days INTEGER,
  useful_life_months        INTEGER DEFAULT 60,
  salvage_value             NUMERIC DEFAULT 0,
  auto_write_off            BOOLEAN DEFAULT true,
  book_value                NUMERIC,
  brand                     VARCHAR(255),
  model                     VARCHAR(255),
  specifications            JSONB,
  notes                     TEXT,
  status                    VARCHAR(50),
  warehouse_id              INTEGER REFERENCES warehouses(id),
  current_holder_id         INTEGER REFERENCES users(id),
  current_object_id         INTEGER REFERENCES objects(id),
  condition                 VARCHAR(50),
  next_maintenance          DATE,
  next_calibration          DATE,
  balance_status            VARCHAR(50),
  balance_date              DATE,
  written_off_date          DATE,
  written_off_reason        TEXT,
  written_off_by            INTEGER REFERENCES users(id),
  accumulated_depreciation  NUMERIC,
  created_by                INTEGER REFERENCES users(id),
  created_at                TIMESTAMP DEFAULT NOW(),
  updated_at                TIMESTAMP
);

-- 57. equipment_movements (equipment.js)
CREATE TABLE IF NOT EXISTS equipment_movements (
  id                SERIAL PRIMARY KEY,
  equipment_id      INTEGER REFERENCES equipment(id),
  movement_type     VARCHAR(100),
  from_warehouse_id INTEGER REFERENCES warehouses(id),
  to_warehouse_id   INTEGER REFERENCES warehouses(id),
  from_holder_id    INTEGER REFERENCES users(id),
  to_holder_id      INTEGER REFERENCES users(id),
  from_object_id    INTEGER REFERENCES objects(id),
  to_object_id      INTEGER REFERENCES objects(id),
  work_id           INTEGER REFERENCES works(id),
  quantity          INTEGER,
  condition_before  VARCHAR(50),
  condition_after   VARCHAR(50),
  notes             TEXT,
  confirmed         BOOLEAN DEFAULT false,
  confirmed_at      TIMESTAMP,
  created_by        INTEGER REFERENCES users(id),
  created_at        TIMESTAMP DEFAULT NOW()
);

-- 58. equipment_maintenance (equipment.js)
CREATE TABLE IF NOT EXISTS equipment_maintenance (
  id               SERIAL PRIMARY KEY,
  equipment_id     INTEGER REFERENCES equipment(id),
  maintenance_type VARCHAR(100),
  description      TEXT,
  cost             NUMERIC,
  performed_by     VARCHAR(255),
  started_at       TIMESTAMP,
  completed_at     TIMESTAMP,
  created_by       INTEGER REFERENCES users(id),
  created_at       TIMESTAMP DEFAULT NOW()
);

-- 59. equipment_reservations (equipment.js)
CREATE TABLE IF NOT EXISTS equipment_reservations (
  id            SERIAL PRIMARY KEY,
  equipment_id  INTEGER REFERENCES equipment(id),
  work_id       INTEGER REFERENCES works(id),
  reserved_by   INTEGER REFERENCES users(id),
  reserved_from DATE,
  reserved_to   DATE,
  notes         TEXT,
  status        VARCHAR(50)
);

-- 60. equipment_requests (equipment.js)
CREATE TABLE IF NOT EXISTS equipment_requests (
  id               SERIAL PRIMARY KEY,
  request_type     VARCHAR(100),
  requester_id     INTEGER REFERENCES users(id),
  equipment_id     INTEGER REFERENCES equipment(id),
  work_id          INTEGER REFERENCES works(id),
  object_id        INTEGER REFERENCES objects(id),
  target_holder_id INTEGER REFERENCES users(id),
  quantity         INTEGER,
  notes            TEXT,
  status           VARCHAR(50),
  reject_reason    TEXT,
  processed_by     INTEGER REFERENCES users(id),
  processed_at     TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- 61. correspondence (mailbox.js, inbox_applications_ai.js)
CREATE TABLE IF NOT EXISTS correspondence (
  id                          SERIAL PRIMARY KEY,
  direction                   VARCHAR(20),
  number                      VARCHAR(100),
  date                        DATE,
  doc_type                    VARCHAR(100),
  subject                     VARCHAR(500),
  body                        TEXT,
  counterparty                VARCHAR(500),
  contact_person              VARCHAR(255),
  email_id                    INTEGER,
  tender_id                   INTEGER REFERENCES tenders(id),
  work_id                     INTEGER REFERENCES works(id),
  linked_inbox_application_id INTEGER,
  status                      VARCHAR(50),
  created_by                  INTEGER REFERENCES users(id),
  created_at                  TIMESTAMP DEFAULT NOW(),
  updated_at                  TIMESTAMP
);

CREATE SEQUENCE IF NOT EXISTS correspondence_outgoing_seq;

-- 62. inbox_applications (inbox_applications_ai.js)
CREATE TABLE IF NOT EXISTS inbox_applications (
  id                  SERIAL PRIMARY KEY,
  email_id            INTEGER REFERENCES emails(id),
  source              VARCHAR(100),
  source_email        VARCHAR(255),
  source_name         VARCHAR(500),
  subject             VARCHAR(500),
  body_preview        TEXT,
  attachment_count    INTEGER,
  status              VARCHAR(50),
  created_by          INTEGER REFERENCES users(id),
  ai_classification   VARCHAR(100),
  ai_color            VARCHAR(50),
  ai_summary          TEXT,
  ai_recommendation   TEXT,
  ai_work_type        VARCHAR(100),
  ai_estimated_budget NUMERIC,
  ai_estimated_days   INTEGER,
  ai_keywords         TEXT[],
  ai_confidence       NUMERIC,
  ai_raw_json         JSONB,
  ai_analyzed_at      TIMESTAMP,
  ai_model            VARCHAR(100),
  workload_snapshot   JSONB,
  ai_report           TEXT,
  decision_by         INTEGER REFERENCES users(id),
  decision_at         TIMESTAMP,
  decision_notes      TEXT,
  rejection_reason    TEXT,
  linked_tender_id    INTEGER REFERENCES tenders(id),
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP
);

-- 63. ai_analysis_log (inbox_applications_ai.js)
CREATE TABLE IF NOT EXISTS ai_analysis_log (
  id            SERIAL PRIMARY KEY,
  entity_type   VARCHAR(100),
  entity_id     INTEGER,
  analysis_type VARCHAR(100),
  model         VARCHAR(100),
  provider      VARCHAR(100),
  duration_ms   INTEGER,
  output_json   JSONB,
  error         TEXT,
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMP DEFAULT NOW()
);

-- 64. pre_tender_requests (pre_tenders.js, integrations.js)
CREATE TABLE IF NOT EXISTS pre_tender_requests (
  id                  SERIAL PRIMARY KEY,
  email_id            INTEGER,
  source_type         VARCHAR(50),
  customer_name       VARCHAR(500),
  customer_email      VARCHAR(255),
  customer_inn        VARCHAR(12),
  contact_person      VARCHAR(255),
  contact_phone       VARCHAR(100),
  work_description    TEXT,
  work_location       VARCHAR(500),
  work_deadline       DATE,
  estimated_sum       NUMERIC,
  ai_summary          TEXT,
  ai_color            VARCHAR(50),
  ai_recommendation   TEXT,
  ai_work_match_score NUMERIC,
  status              VARCHAR(50) DEFAULT 'new',
  created_by          INTEGER REFERENCES users(id),
  decision_by         INTEGER REFERENCES users(id),
  decision_at         TIMESTAMP,
  decision_comment    TEXT,
  reject_reason       TEXT,
  created_tender_id   INTEGER REFERENCES tenders(id),
  assigned_to         INTEGER REFERENCES users(id),
  response_email_id   INTEGER,
  manual_documents    JSONB,
  has_documents       BOOLEAN DEFAULT false,
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP
);

-- 65. bank_import_batches (integrations.js)
CREATE TABLE IF NOT EXISTS bank_import_batches (
  id              SERIAL PRIMARY KEY,
  filename        VARCHAR(500),
  source_format   VARCHAR(50),
  total_rows      INTEGER,
  imported_by     INTEGER REFERENCES users(id),
  new_rows        INTEGER,
  duplicate_rows  INTEGER,
  auto_classified INTEGER,
  manual_needed   INTEGER,
  status          VARCHAR(50),
  created_at      TIMESTAMP DEFAULT NOW()
);

-- 66. bank_transactions (integrations.js)
CREATE TABLE IF NOT EXISTS bank_transactions (
  id                    SERIAL PRIMARY KEY,
  import_hash           VARCHAR(255) UNIQUE,
  batch_id              INTEGER REFERENCES bank_import_batches(id),
  transaction_date      DATE,
  amount                NUMERIC,
  direction             VARCHAR(20),
  currency              VARCHAR(10),
  counterparty_name     VARCHAR(500),
  counterparty_inn      VARCHAR(12),
  counterparty_kpp      VARCHAR(20),
  counterparty_account  VARCHAR(50),
  counterparty_bank_bik VARCHAR(20),
  our_account           VARCHAR(50),
  our_bank_bik          VARCHAR(20),
  payment_purpose       TEXT,
  description           TEXT,
  document_number       VARCHAR(100),
  document_date         DATE,
  article               VARCHAR(255),
  article_confidence    NUMERIC,
  category_1c           VARCHAR(255),
  work_id               INTEGER REFERENCES works(id),
  tender_id             INTEGER REFERENCES tenders(id),
  status                VARCHAR(50),
  source_format         VARCHAR(50),
  source_filename       VARCHAR(500),
  imported_by           INTEGER REFERENCES users(id),
  confirmed_by          INTEGER REFERENCES users(id),
  confirmed_at          TIMESTAMP,
  linked_income_id      INTEGER,
  linked_expense_id     INTEGER,
  created_at            TIMESTAMP DEFAULT NOW(),
  updated_at            TIMESTAMP
);

-- 67. bank_classification_rules (integrations.js)
CREATE TABLE IF NOT EXISTS bank_classification_rules (
  id          SERIAL PRIMARY KEY,
  pattern     VARCHAR(500),
  match_field VARCHAR(100),
  direction   VARCHAR(20),
  article     VARCHAR(255),
  category_1c VARCHAR(255),
  work_id     INTEGER REFERENCES works(id),
  priority    INTEGER,
  usage_count INTEGER DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  is_system   BOOLEAN DEFAULT false,
  created_by  INTEGER REFERENCES users(id)
);

-- 68. platform_parse_results (integrations.js)
CREATE TABLE IF NOT EXISTS platform_parse_results (
  id                   SERIAL PRIMARY KEY,
  platform_code        VARCHAR(50),
  platform_name        VARCHAR(255),
  email_id             INTEGER,
  purchase_number      VARCHAR(255),
  purchase_url         VARCHAR(1000),
  lot_number           VARCHAR(50),
  purchase_method      VARCHAR(255),
  customer_name        VARCHAR(500),
  customer_inn         VARCHAR(12),
  object_description   TEXT,
  nmck                 NUMERIC,
  application_deadline TIMESTAMP,
  auction_date         TIMESTAMP,
  work_start_date      DATE,
  work_end_date        DATE,
  ai_analysis          TEXT,
  ai_relevance_score   NUMERIC,
  pre_tender_id        INTEGER REFERENCES pre_tender_requests(id),
  parse_status         VARCHAR(50),
  docs_download_error  TEXT,
  created_at           TIMESTAMP DEFAULT NOW(),
  updated_at           TIMESTAMP
);

-- 69. erp_connections (integrations.js)
CREATE TABLE IF NOT EXISTS erp_connections (
  id                         SERIAL PRIMARY KEY,
  name                       VARCHAR(255),
  erp_type                   VARCHAR(100),
  connection_url             VARCHAR(1000),
  auth_type                  VARCHAR(50),
  auth_credentials_encrypted TEXT,
  sync_direction             VARCHAR(50),
  sync_interval_minutes      INTEGER,
  is_active                  BOOLEAN DEFAULT true,
  last_sync_at               TIMESTAMP,
  last_sync_status           VARCHAR(50),
  last_sync_error            TEXT,
  webhook_secret             VARCHAR(255),
  created_by                 INTEGER REFERENCES users(id),
  created_at                 TIMESTAMP DEFAULT NOW(),
  updated_at                 TIMESTAMP
);

-- 70. erp_field_mappings (integrations.js)
CREATE TABLE IF NOT EXISTS erp_field_mappings (
  id             SERIAL PRIMARY KEY,
  connection_id  INTEGER REFERENCES erp_connections(id),
  entity_type    VARCHAR(100),
  crm_field      VARCHAR(255),
  erp_field      VARCHAR(255),
  transform_rule TEXT,
  is_required    BOOLEAN DEFAULT false
);

-- 71. erp_sync_log (integrations.js)
CREATE TABLE IF NOT EXISTS erp_sync_log (
  id              SERIAL PRIMARY KEY,
  connection_id   INTEGER REFERENCES erp_connections(id),
  direction       VARCHAR(50),
  entity_type     VARCHAR(100),
  records_total   INTEGER,
  records_success INTEGER,
  records_failed  INTEGER,
  error_details   JSONB,
  status          VARCHAR(50),
  started_at      TIMESTAMP,
  completed_at    TIMESTAMP,
  initiated_by    INTEGER REFERENCES users(id)
);

-- 72. one_time_payments (payroll.js)
CREATE TABLE IF NOT EXISTS one_time_payments (
  id               SERIAL PRIMARY KEY,
  employee_id      INTEGER REFERENCES employees(id),
  employee_name    VARCHAR(500),
  work_id          INTEGER REFERENCES works(id),
  amount           NUMERIC,
  reason           TEXT,
  payment_method   VARCHAR(50),
  payment_type     VARCHAR(50),
  comment          TEXT,
  receipt_url      VARCHAR(1000),
  requested_by     INTEGER REFERENCES users(id),
  status           VARCHAR(50),
  approved_by      INTEGER REFERENCES users(id),
  approved_at      TIMESTAMP,
  director_comment TEXT,
  paid_at          TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP
);

-- 73. mimir_messages (mimir.js)
CREATE TABLE IF NOT EXISTS mimir_messages (
  id              SERIAL PRIMARY KEY,
  conversation_id INTEGER REFERENCES mimir_conversations(id),
  role            VARCHAR(20),
  content         TEXT,
  content_type    VARCHAR(50),
  has_files       BOOLEAN DEFAULT false,
  file_names      TEXT[],
  search_results  JSONB,
  tokens_input    INTEGER,
  tokens_output   INTEGER,
  model_used      VARCHAR(100),
  duration_ms     INTEGER,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- 74. mimir_usage_log (mimir.js)
CREATE TABLE IF NOT EXISTS mimir_usage_log (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER REFERENCES users(id),
  conversation_id INTEGER REFERENCES mimir_conversations(id),
  provider        VARCHAR(50),
  model           VARCHAR(100),
  tokens_input    INTEGER DEFAULT 0,
  tokens_output   INTEGER DEFAULT 0,
  duration_ms     INTEGER DEFAULT 0,
  success         BOOLEAN DEFAULT true,
  error_message   TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);


-- =========================================================================
-- TIER 4: Tables referencing Tier 3 tables
-- =========================================================================

-- 75. meeting_minutes (meetings.js)
CREATE TABLE IF NOT EXISTS meeting_minutes (
  id                  SERIAL PRIMARY KEY,
  meeting_id          INTEGER REFERENCES meetings(id),
  item_order          INTEGER,
  item_type           VARCHAR(100),
  content             TEXT,
  responsible_user_id INTEGER REFERENCES users(id),
  deadline            TIMESTAMP,
  task_id             INTEGER REFERENCES tasks(id),
  created_by          INTEGER REFERENCES users(id),
  created_at          TIMESTAMP DEFAULT NOW()
);

-- 76. payroll_items (payroll.js)
CREATE TABLE IF NOT EXISTS payroll_items (
  id                SERIAL PRIMARY KEY,
  sheet_id          INTEGER REFERENCES payroll_sheets(id),
  employee_id       INTEGER REFERENCES employees(id),
  employee_name     VARCHAR(500),
  work_id           INTEGER REFERENCES works(id),
  role_on_work      VARCHAR(100),
  days_worked       INTEGER,
  day_rate          NUMERIC,
  base_amount       NUMERIC,
  bonus             NUMERIC,
  overtime_hours    NUMERIC,
  overtime_rate     NUMERIC,
  overtime_amount   NUMERIC,
  penalty           NUMERIC,
  penalty_reason    TEXT,
  advance_paid      NUMERIC,
  deductions        NUMERIC,
  deductions_reason TEXT,
  accrued           NUMERIC,
  payout            NUMERIC,
  payment_method    VARCHAR(50),
  is_self_employed  BOOLEAN DEFAULT false,
  comment           TEXT,
  updated_at        TIMESTAMP
);

-- 77. payment_registry (payroll.js)
CREATE TABLE IF NOT EXISTS payment_registry (
  id                   SERIAL PRIMARY KEY,
  sheet_id             INTEGER REFERENCES payroll_sheets(id),
  employee_id          INTEGER REFERENCES employees(id),
  amount               NUMERIC,
  payment_type         VARCHAR(50),
  payment_date         DATE,
  status               VARCHAR(50),
  bank_ref             VARCHAR(255),
  payment_order_number VARCHAR(100),
  paid_at              TIMESTAMP,
  created_at           TIMESTAMP DEFAULT NOW()
);


-- =========================================================================
-- TIER 5: Skeleton tables from data.js ALLOWED_TABLES
-- (Referenced in the universal Data API but without dedicated route files)
-- =========================================================================

-- 78. work_assign_requests
CREATE TABLE IF NOT EXISTS work_assign_requests (
  id         SERIAL PRIMARY KEY,
  work_id    INTEGER REFERENCES works(id),
  user_id    INTEGER REFERENCES users(id),
  status     VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 79. pm_consents
CREATE TABLE IF NOT EXISTS pm_consents (
  id         SERIAL PRIMARY KEY,
  work_id    INTEGER REFERENCES works(id),
  pm_id      INTEGER REFERENCES users(id),
  status     VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 80. travel_expenses
CREATE TABLE IF NOT EXISTS travel_expenses (
  id          SERIAL PRIMARY KEY,
  work_id     INTEGER REFERENCES works(id),
  description TEXT,
  amount      NUMERIC,
  date        DATE,
  created_by  INTEGER REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP
);

-- 81. contracts
CREATE TABLE IF NOT EXISTS contracts (
  id         SERIAL PRIMARY KEY,
  work_id    INTEGER REFERENCES works(id),
  tender_id  INTEGER REFERENCES tenders(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 82. bonus_requests
CREATE TABLE IF NOT EXISTS bonus_requests (
  id         SERIAL PRIMARY KEY,
  work_id    INTEGER REFERENCES works(id),
  created_by INTEGER REFERENCES users(id),
  status     VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 83. staff_requests
CREATE TABLE IF NOT EXISTS staff_requests (
  id         SERIAL PRIMARY KEY,
  created_by INTEGER REFERENCES users(id),
  status     VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 84. staff_request_messages
CREATE TABLE IF NOT EXISTS staff_request_messages (
  id               SERIAL PRIMARY KEY,
  staff_request_id INTEGER REFERENCES staff_requests(id),
  user_id          INTEGER REFERENCES users(id),
  message          TEXT,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- 85. staff_replacements
CREATE TABLE IF NOT EXISTS staff_replacements (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 86. purchase_requests
CREATE TABLE IF NOT EXISTS purchase_requests (
  id         SERIAL PRIMARY KEY,
  created_by INTEGER REFERENCES users(id),
  status     VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 87. qa_messages
CREATE TABLE IF NOT EXISTS qa_messages (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 88. doc_sets
CREATE TABLE IF NOT EXISTS doc_sets (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 89. sync_meta (data.js -- PK = table_name)
CREATE TABLE IF NOT EXISTS sync_meta (
  table_name VARCHAR(255) PRIMARY KEY,
  last_sync  TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 90. user_dashboard (data.js -- PK = user_id)
CREATE TABLE IF NOT EXISTS user_dashboard (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id),
  config     JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 91. call_history
CREATE TABLE IF NOT EXISTS call_history (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 92. user_call_status (data.js -- PK = user_id)
CREATE TABLE IF NOT EXISTS user_call_status (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id),
  status     VARCHAR(50),
  updated_at TIMESTAMP
);

-- 93. customer_reviews
CREATE TABLE IF NOT EXISTS customer_reviews (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 94. reminders
CREATE TABLE IF NOT EXISTS reminders (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 95. email_history
CREATE TABLE IF NOT EXISTS email_history (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 96. email_queue
CREATE TABLE IF NOT EXISTS email_queue (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);
