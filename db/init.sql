-- =====================================================================================
-- ASGARD CRM -- Complete Database Initialization
-- db/init.sql
--
-- Run on a fresh PostgreSQL database:
--   psql -U asgard -d asgard_crm -f db/init.sql
--
-- Creates ALL tables, indexes, FK constraints, and seed data.
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT DO NOTHING.
-- =====================================================================================

-- =========================================================================
-- TIER 0: Foundation tables (no foreign keys)
-- =========================================================================

-- 1. users
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

-- 2. staff
CREATE TABLE IF NOT EXISTS staff (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255),
  position   VARCHAR(255),
  department VARCHAR(255),
  phone      VARCHAR(50),
  email      VARCHAR(255),
  user_id    INTEGER,
  role_tag   VARCHAR(50),
  is_active  BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 3. settings
CREATE TABLE IF NOT EXISTS settings (
  key        VARCHAR(255) PRIMARY KEY,
  value_json TEXT,
  updated_at TIMESTAMP
);

-- 4. modules
CREATE TABLE IF NOT EXISTS modules (
  id         SERIAL PRIMARY KEY,
  key        VARCHAR(255) NOT NULL UNIQUE,
  name       VARCHAR(255),
  is_active  BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0
);

-- 5. customers
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

-- 6. equipment_categories
CREATE TABLE IF NOT EXISTS equipment_categories (
  id                   SERIAL PRIMARY KEY,
  name                 VARCHAR(255),
  icon                 VARCHAR(100),
  sort_order           INTEGER,
  code                 VARCHAR(50),
  is_consumable        BOOLEAN DEFAULT false,
  requires_calibration BOOLEAN DEFAULT false
);

-- 7. objects
CREATE TABLE IF NOT EXISTS objects (
  id        SERIAL PRIMARY KEY,
  name      VARCHAR(500),
  is_active BOOLEAN DEFAULT true
);

-- 8. permit_types
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
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP
);

-- 9. seals
CREATE TABLE IF NOT EXISTS seals (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(255),
  created_at TIMESTAMP DEFAULT NOW()
);


-- =========================================================================
-- TIER 1: Tables referencing only users or Tier 0
-- =========================================================================

-- 10. user_requests
CREATE TABLE IF NOT EXISTS user_requests (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  status     VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- 11. user_permissions
CREATE TABLE IF NOT EXISTS user_permissions (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  module_key VARCHAR(255) NOT NULL,
  can_read   BOOLEAN DEFAULT false,
  can_write  BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  granted_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (user_id, module_key)
);

-- 12. role_presets
CREATE TABLE IF NOT EXISTS role_presets (
  id         SERIAL PRIMARY KEY,
  role       VARCHAR(50) NOT NULL,
  module_key VARCHAR(255) NOT NULL,
  can_read   BOOLEAN DEFAULT false,
  can_write  BOOLEAN DEFAULT false,
  can_delete BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (role, module_key)
);

-- 13. user_menu_settings
CREATE TABLE IF NOT EXISTS user_menu_settings (
  user_id       INTEGER PRIMARY KEY REFERENCES users(id),
  hidden_routes JSONB DEFAULT '[]',
  route_order   JSONB DEFAULT '[]',
  updated_at    TIMESTAMP
);

-- 14. notifications
CREATE TABLE IF NOT EXISTS notifications (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  title      VARCHAR(500),
  message    TEXT,
  body       TEXT,
  type       VARCHAR(100),
  link       VARCHAR(500),
  url        VARCHAR(500),
  entity_id  INTEGER,
  is_read    BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 15. sites
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

-- 16. tenders
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

-- 17. audit_log
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

-- 18. employees
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

-- 19. warehouses
CREATE TABLE IF NOT EXISTS warehouses (
  id             SERIAL PRIMARY KEY,
  name           VARCHAR(255),
  responsible_id INTEGER REFERENCES users(id),
  is_active      BOOLEAN DEFAULT true,
  is_main        BOOLEAN DEFAULT false
);

-- 20. email_accounts
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

-- 21. saved_reports
CREATE TABLE IF NOT EXISTS saved_reports (
  id          SERIAL PRIMARY KEY,
  type        VARCHAR(50),
  period      VARCHAR(100),
  period_code VARCHAR(50) UNIQUE,
  data        JSONB,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 22. email_log
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

-- 23. reminders
CREATE TABLE IF NOT EXISTS reminders (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id),
  title         VARCHAR(255),
  description   TEXT,
  reminder_date TIMESTAMPTZ,
  due_date      TIMESTAMPTZ,
  status        VARCHAR(50) DEFAULT 'active',
  completed     BOOLEAN DEFAULT false,
  dismissed     BOOLEAN DEFAULT false,
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 24. mimir_conversations
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
-- TIER 2: Tables referencing Tier 1
-- =========================================================================

-- 25. works
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

-- 26. estimates
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

-- 27. documents
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

-- 28. emails
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

-- 29. email_attachments
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

-- 30. email_sync_log
CREATE TABLE IF NOT EXISTS email_sync_log (
  id           SERIAL PRIMARY KEY,
  account_id   INTEGER REFERENCES email_accounts(id),
  started_at   TIMESTAMP,
  completed_at TIMESTAMP,
  status       VARCHAR(50),
  new_emails   INTEGER,
  error        TEXT
);

-- 31. email_templates_v2
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

-- 32. email_classification_rules
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

-- 33. calendar_events
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

-- 34. employee_reviews
CREATE TABLE IF NOT EXISTS employee_reviews (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  rating      INTEGER,
  score_1_10  INTEGER,
  comment     TEXT,
  pm_id       INTEGER REFERENCES users(id),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 35. employee_permits (with CASCADE)
CREATE TABLE IF NOT EXISTS employee_permits (
  id                  SERIAL PRIMARY KEY,
  employee_id         INTEGER REFERENCES employees(id) ON DELETE CASCADE,
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

-- 36. permit_applications
CREATE TABLE IF NOT EXISTS permit_applications (
  id               SERIAL PRIMARY KEY,
  number           VARCHAR(100),
  title            VARCHAR(500),
  contractor_name  VARCHAR(500),
  contractor_email VARCHAR(255),
  cover_letter     TEXT,
  status           VARCHAR(50) DEFAULT 'draft',
  created_by       INTEGER REFERENCES users(id),
  sent_by          INTEGER REFERENCES users(id),
  sent_at          TIMESTAMP,
  email_message_id VARCHAR(500),
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP
);

-- 37. seal_transfers
CREATE TABLE IF NOT EXISTS seal_transfers (
  id         SERIAL PRIMARY KEY,
  seal_id    INTEGER REFERENCES seals(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 38. employee_rates
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

-- 39. self_employed
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


-- =========================================================================
-- TIER 3: Tables referencing Tier 2 (works, emails, etc.)
-- =========================================================================

-- 40. work_expenses
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

-- 41. office_expenses
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

-- 42. incomes
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

-- 43. acts
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

-- 44. invoices
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

-- 45. invoice_payments
CREATE TABLE IF NOT EXISTS invoice_payments (
  id           SERIAL PRIMARY KEY,
  invoice_id   INTEGER REFERENCES invoices(id),
  amount       NUMERIC,
  payment_date DATE,
  comment      TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   TIMESTAMP DEFAULT NOW()
);

-- 46. employee_plan
CREATE TABLE IF NOT EXISTS employee_plan (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  date        DATE,
  work_id     INTEGER REFERENCES works(id),
  note        TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 47. employee_assignments
CREATE TABLE IF NOT EXISTS employee_assignments (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER REFERENCES employees(id),
  work_id     INTEGER REFERENCES works(id) ON DELETE CASCADE,
  role        VARCHAR(100),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 48. work_permit_requirements
CREATE TABLE IF NOT EXISTS work_permit_requirements (
  id             SERIAL PRIMARY KEY,
  work_id        INTEGER REFERENCES works(id),
  permit_type_id INTEGER REFERENCES permit_types(id),
  is_mandatory   BOOLEAN DEFAULT true,
  notes          TEXT,
  created_at     TIMESTAMP DEFAULT NOW()
);

-- 49. permit_application_items (with CASCADE)
CREATE TABLE IF NOT EXISTS permit_application_items (
  id              SERIAL PRIMARY KEY,
  application_id  INTEGER REFERENCES permit_applications(id) ON DELETE CASCADE,
  employee_id     INTEGER REFERENCES employees(id),
  permit_type_ids INTEGER[],
  notes           TEXT
);

-- 50. permit_application_history (with CASCADE)
CREATE TABLE IF NOT EXISTS permit_application_history (
  id             SERIAL PRIMARY KEY,
  application_id INTEGER REFERENCES permit_applications(id) ON DELETE CASCADE,
  old_status     VARCHAR(50),
  new_status     VARCHAR(50),
  changed_by     INTEGER REFERENCES users(id),
  comment        TEXT,
  created_at     TIMESTAMP DEFAULT NOW()
);

-- 51. tasks
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

-- 52. todo_items
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

-- 53. task_comments
CREATE TABLE IF NOT EXISTS task_comments (
  id         SERIAL PRIMARY KEY,
  task_id    INTEGER REFERENCES tasks(id),
  user_id    INTEGER REFERENCES users(id),
  text       TEXT,
  is_system  BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 54. task_watchers
CREATE TABLE IF NOT EXISTS task_watchers (
  task_id    INTEGER REFERENCES tasks(id),
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (task_id, user_id)
);

-- 55. meetings
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

-- 56. meeting_participants
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

-- 57. payroll_sheets
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

-- 58. equipment
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

-- 59. equipment_movements
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

-- 60. equipment_maintenance
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

-- 61. equipment_reservations
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

-- 62. equipment_requests
CREATE TABLE IF NOT EXISTS equipment_requests (
  id               SERIAL PRIMARY KEY,
  request_type     VARCHAR(100),
  requester_id     INTEGER REFERENCES users(id),
  equipment_id     INTEGER REFERENCES equipment(id),
  equipment_name   VARCHAR(500),
  work_id          INTEGER REFERENCES works(id),
  object_id        INTEGER REFERENCES objects(id),
  target_holder_id INTEGER REFERENCES users(id),
  quantity         INTEGER,
  notes            TEXT,
  status           VARCHAR(50) DEFAULT 'new',
  reject_reason    TEXT,
  processed_by     INTEGER REFERENCES users(id),
  processed_at     TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- 63. correspondence
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

-- 64. inbox_applications
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

-- 65. ai_analysis_log
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

-- 66. pre_tender_requests
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

-- 67. bank_import_batches
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

-- 68. bank_transactions
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

-- 69. bank_classification_rules (bank_rules alias)
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

-- 70. platform_parse_results
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

-- 71. erp_connections
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

-- 72. erp_field_mappings
CREATE TABLE IF NOT EXISTS erp_field_mappings (
  id             SERIAL PRIMARY KEY,
  connection_id  INTEGER REFERENCES erp_connections(id),
  entity_type    VARCHAR(100),
  crm_field      VARCHAR(255),
  erp_field      VARCHAR(255),
  transform_rule TEXT,
  is_required    BOOLEAN DEFAULT false
);

-- 73. erp_sync_log
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

-- 74. one_time_payments
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

-- 75. mimir_messages
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

-- 76. mimir_usage_log
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
-- TIER 4: Tables referencing Tier 3
-- =========================================================================

-- 77. meeting_minutes
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

-- 78. payroll_items
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

-- 79. payment_registry
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
-- TIER 5: Chat, Cash, Push, WebAuthn tables (from ensureTables)
-- =========================================================================

-- 80. chat_messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id          SERIAL PRIMARY KEY,
  chat_type   VARCHAR(50) DEFAULT 'general',
  entity_id   INTEGER,
  entity_title VARCHAR(255),
  chat_id     INTEGER,
  to_user_id  INTEGER,
  user_id     INTEGER,
  user_name   VARCHAR(255),
  user_role   VARCHAR(50),
  text        TEXT,
  message     TEXT,
  attachments TEXT,
  mentions    TEXT,
  reply_to    INTEGER,
  reactions   JSONB DEFAULT '{}',
  is_system   BOOLEAN DEFAULT false,
  is_read     BOOLEAN DEFAULT false,
  edited_at   TIMESTAMP,
  deleted_at  TIMESTAMP,
  created_at  TIMESTAMP DEFAULT NOW(),
  updated_at  TIMESTAMP DEFAULT NOW()
);

-- 81. chats
CREATE TABLE IF NOT EXISTS chats (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(255),
  chat_type       VARCHAR(50) DEFAULT 'direct',
  type            VARCHAR(50) DEFAULT 'direct',
  participants    TEXT,
  is_group        BOOLEAN DEFAULT false,
  description     TEXT,
  is_readonly     BOOLEAN DEFAULT false,
  archived_at     TIMESTAMP,
  last_message_at TIMESTAMP,
  created_by      INTEGER,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- 82. chat_group_members
CREATE TABLE IF NOT EXISTS chat_group_members (
  id           SERIAL PRIMARY KEY,
  chat_id      INTEGER NOT NULL,
  user_id      INTEGER NOT NULL,
  role         VARCHAR(20) DEFAULT 'member',
  joined_at    TIMESTAMP DEFAULT NOW(),
  last_read_at TIMESTAMP,
  muted_until  TIMESTAMP,
  UNIQUE(chat_id, user_id)
);

-- 83. chat_attachments
CREATE TABLE IF NOT EXISTS chat_attachments (
  id         SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL,
  file_name  VARCHAR(255),
  file_path  VARCHAR(500),
  file_size  INTEGER,
  mime_type  VARCHAR(100),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 84. cash_requests
CREATE TABLE IF NOT EXISTS cash_requests (
  id               SERIAL PRIMARY KEY,
  user_id          INTEGER NOT NULL,
  work_id          INTEGER,
  type             VARCHAR(20) DEFAULT 'advance',
  amount           NUMERIC(12,2) NOT NULL,
  purpose          TEXT,
  cover_letter     TEXT,
  status           VARCHAR(30) DEFAULT 'requested',
  director_id      INTEGER,
  director_comment TEXT,
  received_at      TIMESTAMP,
  closed_at        TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);

-- 85. cash_expenses
CREATE TABLE IF NOT EXISTS cash_expenses (
  id                    SERIAL PRIMARY KEY,
  request_id            INTEGER NOT NULL REFERENCES cash_requests(id),
  amount                NUMERIC(12,2) NOT NULL,
  description           TEXT,
  category              VARCHAR(50) DEFAULT 'other',
  receipt_file          VARCHAR(500),
  receipt_original_name VARCHAR(255),
  expense_date          DATE,
  created_at            TIMESTAMP DEFAULT NOW()
);

-- 86. cash_returns
CREATE TABLE IF NOT EXISTS cash_returns (
  id           SERIAL PRIMARY KEY,
  request_id   INTEGER NOT NULL REFERENCES cash_requests(id),
  amount       NUMERIC(12,2) NOT NULL,
  note         TEXT,
  confirmed_at TIMESTAMP,
  confirmed_by INTEGER,
  created_at   TIMESTAMP DEFAULT NOW()
);

-- 87. cash_messages
CREATE TABLE IF NOT EXISTS cash_messages (
  id         SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES cash_requests(id),
  user_id    INTEGER,
  message    TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 88. staff_plan
CREATE TABLE IF NOT EXISTS staff_plan (
  id          SERIAL PRIMARY KEY,
  staff_id    INTEGER,
  date        DATE,
  status_code VARCHAR(20),
  created_by  INTEGER,
  updated_at  TIMESTAMP DEFAULT NOW(),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 89. push_subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL,
  endpoint    TEXT NOT NULL UNIQUE,
  p256dh      TEXT NOT NULL,
  auth        TEXT NOT NULL,
  device_info VARCHAR(255),
  created_at  TIMESTAMP DEFAULT NOW()
);

-- 90. webauthn_credentials
CREATE TABLE IF NOT EXISTS webauthn_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       INTEGER NOT NULL,
  credential_id TEXT NOT NULL UNIQUE,
  public_key    BYTEA NOT NULL,
  counter       BIGINT NOT NULL DEFAULT 0,
  device_name   VARCHAR(255) DEFAULT 'Устройство',
  transports    TEXT[],
  created_at    TIMESTAMP DEFAULT NOW(),
  last_used_at  TIMESTAMP
);

-- 91. webauthn_challenges
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  challenge  TEXT NOT NULL,
  type       VARCHAR(20) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);


-- =========================================================================
-- TIER 6: Skeleton / auxiliary tables from data.js
-- =========================================================================

-- 92. work_assign_requests
CREATE TABLE IF NOT EXISTS work_assign_requests (
  id         SERIAL PRIMARY KEY,
  work_id    INTEGER REFERENCES works(id),
  user_id    INTEGER REFERENCES users(id),
  status     VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 93. pm_consents
CREATE TABLE IF NOT EXISTS pm_consents (
  id         SERIAL PRIMARY KEY,
  work_id    INTEGER REFERENCES works(id),
  pm_id      INTEGER REFERENCES users(id),
  status     VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 94. travel_expenses
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

-- 95. contracts
CREATE TABLE IF NOT EXISTS contracts (
  id         SERIAL PRIMARY KEY,
  work_id    INTEGER REFERENCES works(id),
  tender_id  INTEGER REFERENCES tenders(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 96. bonus_requests
CREATE TABLE IF NOT EXISTS bonus_requests (
  id         SERIAL PRIMARY KEY,
  work_id    INTEGER REFERENCES works(id),
  created_by INTEGER REFERENCES users(id),
  status     VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 97. staff_requests
CREATE TABLE IF NOT EXISTS staff_requests (
  id            SERIAL PRIMARY KEY,
  requester_id  INTEGER REFERENCES users(id),
  pm_id         INTEGER REFERENCES users(id),
  position_name VARCHAR(255),
  quantity      INTEGER DEFAULT 1,
  status        VARCHAR(50) DEFAULT 'new',
  created_by    INTEGER REFERENCES users(id),
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP
);

-- 98. staff_request_messages
CREATE TABLE IF NOT EXISTS staff_request_messages (
  id               SERIAL PRIMARY KEY,
  staff_request_id INTEGER REFERENCES staff_requests(id),
  user_id          INTEGER REFERENCES users(id),
  message          TEXT,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- 99. staff_replacements
CREATE TABLE IF NOT EXISTS staff_replacements (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 100. purchase_requests
CREATE TABLE IF NOT EXISTS purchase_requests (
  id         SERIAL PRIMARY KEY,
  created_by INTEGER REFERENCES users(id),
  status     VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 101. qa_messages
CREATE TABLE IF NOT EXISTS qa_messages (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 102. doc_sets
CREATE TABLE IF NOT EXISTS doc_sets (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 103. sync_meta
CREATE TABLE IF NOT EXISTS sync_meta (
  table_name VARCHAR(255) PRIMARY KEY,
  last_sync  TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 104. user_dashboard
CREATE TABLE IF NOT EXISTS user_dashboard (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id),
  config     JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP
);

-- 105. call_history
CREATE TABLE IF NOT EXISTS call_history (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- 106. user_call_status
CREATE TABLE IF NOT EXISTS user_call_status (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id),
  status     VARCHAR(50),
  updated_at TIMESTAMP
);

-- 107. customer_reviews
CREATE TABLE IF NOT EXISTS customer_reviews (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 108. email_history
CREATE TABLE IF NOT EXISTS email_history (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 109. email_queue
CREATE TABLE IF NOT EXISTS email_queue (
  id         SERIAL PRIMARY KEY,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 110. bank_rules (alias view for bank_classification_rules)
CREATE OR REPLACE VIEW bank_rules AS SELECT * FROM bank_classification_rules;


-- =========================================================================
-- TIER 7: V031 tables (TKP, Pass Requests, TMC Requests)
-- =========================================================================

-- 111. tkp
CREATE TABLE IF NOT EXISTS tkp (
  id            SERIAL PRIMARY KEY,
  subject       VARCHAR(500) NOT NULL,
  tender_id     INTEGER REFERENCES tenders(id),
  work_id       INTEGER REFERENCES works(id),
  customer_name VARCHAR(500),
  contact_email VARCHAR(255),
  items         JSONB DEFAULT '{}',
  services      TEXT,
  total_sum     NUMERIC(14,2) DEFAULT 0,
  deadline      VARCHAR(100),
  validity_days INTEGER DEFAULT 30,
  status        VARCHAR(20) DEFAULT 'draft',
  author_id     INTEGER NOT NULL REFERENCES users(id),
  sent_at       TIMESTAMP,
  sent_by       INTEGER REFERENCES users(id),
  pdf_path      VARCHAR(500),
  created_at    TIMESTAMP DEFAULT NOW(),
  updated_at    TIMESTAMP DEFAULT NOW()
);

-- 112. pass_requests
CREATE TABLE IF NOT EXISTS pass_requests (
  id             SERIAL PRIMARY KEY,
  work_id        INTEGER REFERENCES works(id),
  object_name    VARCHAR(500) NOT NULL,
  date_from      DATE NOT NULL,
  date_to        DATE NOT NULL,
  workers        JSONB DEFAULT '[]',
  vehicles       JSONB DEFAULT '[]',
  equipment_json JSONB DEFAULT '[]',
  contact_person VARCHAR(255),
  contact_phone  VARCHAR(50),
  notes          TEXT,
  author_id      INTEGER NOT NULL REFERENCES users(id),
  status         VARCHAR(20) DEFAULT 'draft',
  approved_by    INTEGER REFERENCES users(id),
  approved_at    TIMESTAMP,
  created_at     TIMESTAMP DEFAULT NOW(),
  updated_at     TIMESTAMP DEFAULT NOW()
);

-- 113. tmc_requests
CREATE TABLE IF NOT EXISTS tmc_requests (
  id               SERIAL PRIMARY KEY,
  work_id          INTEGER REFERENCES works(id),
  title            VARCHAR(500) NOT NULL,
  items            JSONB DEFAULT '[]',
  total_sum        NUMERIC(14,2) DEFAULT 0,
  priority         VARCHAR(20) DEFAULT 'normal',
  needed_by        DATE,
  delivery_address VARCHAR(500),
  supplier         VARCHAR(500),
  notes            TEXT,
  author_id        INTEGER NOT NULL REFERENCES users(id),
  status           VARCHAR(20) DEFAULT 'draft',
  approved_by      INTEGER REFERENCES users(id),
  approved_at      TIMESTAMP,
  created_at       TIMESTAMP DEFAULT NOW(),
  updated_at       TIMESTAMP DEFAULT NOW()
);


-- =========================================================================
-- INDEXES
-- =========================================================================
CREATE INDEX IF NOT EXISTS idx_users_login ON users(login);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_employees_active ON employees(is_active);
CREATE INDEX IF NOT EXISTS idx_employees_user_id ON employees(user_id);
CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(tender_status);
CREATE INDEX IF NOT EXISTS idx_tenders_pm ON tenders(responsible_pm_id);
CREATE INDEX IF NOT EXISTS idx_works_status ON works(work_status);
CREATE INDEX IF NOT EXISTS idx_works_pm ON works(pm_id);
CREATE INDEX IF NOT EXISTS idx_works_tender ON works(tender_id);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(creator_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_id);
CREATE INDEX IF NOT EXISTS idx_emails_date ON emails(email_date);
CREATE INDEX IF NOT EXISTS idx_emails_thread ON emails(thread_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_calendar_date ON calendar_events(date);
CREATE INDEX IF NOT EXISTS idx_employee_permits_employee ON employee_permits(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_permits_expiry ON employee_permits(expiry_date);
CREATE INDEX IF NOT EXISTS idx_permit_apps_status ON permit_applications(status);
CREATE INDEX IF NOT EXISTS idx_equipment_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_warehouse ON equipment(warehouse_id);
CREATE INDEX IF NOT EXISTS idx_cash_requests_user ON cash_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_requests_status ON cash_requests(status);
CREATE INDEX IF NOT EXISTS idx_push_sub_user_id ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_user_id ON webauthn_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_webauthn_cred_id ON webauthn_credentials(credential_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_chat ON chat_messages(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_user ON chat_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_user ON reminders(user_id);
CREATE INDEX IF NOT EXISTS idx_reminders_due ON reminders(due_date);
CREATE INDEX IF NOT EXISTS idx_payroll_sheets_work ON payroll_sheets(work_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_sheet ON payroll_items(sheet_id);
CREATE INDEX IF NOT EXISTS idx_bank_txn_date ON bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_meetings_start ON meetings(start_time);
CREATE INDEX IF NOT EXISTS idx_role_presets_role ON role_presets(role);
CREATE INDEX IF NOT EXISTS idx_user_perms_user ON user_permissions(user_id);


-- =========================================================================
-- SEED DATA
-- =========================================================================

-- Admin user (password: admin123)
INSERT INTO users (login, password_hash, name, role, is_active, created_at)
VALUES ('admin', '$2a$10$YzQbN0MQkJKlRCwCVrNfj.VBSDeHDvVqLPR4bUl0t3qIfA4qlSGQK', 'Администратор', 'ADMIN', true, NOW())
ON CONFLICT (login) DO NOTHING;

-- Test employees (IDs 1-2 for FK-safe tests)
INSERT INTO employees (id, fio, full_name, is_active, created_at, updated_at)
VALUES (1, 'Тест Сотрудник 1', 'Тест Сотрудник 1', true, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO employees (id, fio, full_name, is_active, created_at, updated_at)
VALUES (2, 'Тест Сотрудник 2', 'Тест Сотрудник 2', true, NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Test employees for all roles (IDs 9000-9014)
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9000, 'Test ADMIN', 'Test Employee ADMIN', true, 'ADMIN', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9001, 'Test PM', 'Test Employee PM', true, 'PM', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9002, 'Test TO', 'Test Employee TO', true, 'TO', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9003, 'Test HEAD_PM', 'Test Employee HEAD_PM', true, 'HEAD_PM', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9004, 'Test HEAD_TO', 'Test Employee HEAD_TO', true, 'HEAD_TO', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9005, 'Test HR', 'Test Employee HR', true, 'HR', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9006, 'Test HR_MANAGER', 'Test Employee HR_MANAGER', true, 'HR_MANAGER', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9007, 'Test BUH', 'Test Employee BUH', true, 'BUH', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9008, 'Test PROC', 'Test Employee PROC', true, 'PROC', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9009, 'Test OFFICE_MANAGER', 'Test Employee OFFICE_MANAGER', true, 'OFFICE_MANAGER', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9010, 'Test CHIEF_ENGINEER', 'Test Employee CHIEF_ENGINEER', true, 'CHIEF_ENGINEER', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9011, 'Test DIRECTOR_GEN', 'Test Employee DIRECTOR_GEN', true, 'DIRECTOR_GEN', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9012, 'Test DIRECTOR_COMM', 'Test Employee DIRECTOR_COMM', true, 'DIRECTOR_COMM', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9013, 'Test DIRECTOR_DEV', 'Test Employee DIRECTOR_DEV', true, 'DIRECTOR_DEV', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;
INSERT INTO employees (id, fio, full_name, is_active, role_tag, created_at, updated_at) VALUES (9014, 'Test WAREHOUSE', 'Test Employee WAREHOUSE', true, 'WAREHOUSE', NOW(), NOW()) ON CONFLICT (id) DO NOTHING;

-- Update employees sequence
SELECT setval('employees_id_seq', GREATEST((SELECT MAX(id) FROM employees), 9014));

-- Permit types
INSERT INTO permit_types (id, code, name, category, is_active, created_at)
VALUES (1, 'safety_basic', 'Допуск по безопасности', 'safety', true, NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO permit_types (id, code, name, category, is_active, created_at)
VALUES (2, 'electric_basic', 'Допуск электрика', 'electric', true, NOW())
ON CONFLICT (id) DO NOTHING;

INSERT INTO permit_types (id, code, name, category, is_active, created_at)
VALUES (3, 'height_work', 'Допуск к высотным работам', 'special', true, NOW())
ON CONFLICT (id) DO NOTHING;

SELECT setval('permit_types_id_seq', GREATEST((SELECT MAX(id) FROM permit_types), 3));

-- Default role presets (module permissions)
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete, created_at) VALUES
  ('ADMIN', 'tenders', true, true, true, NOW()),
  ('ADMIN', 'works', true, true, true, NOW()),
  ('ADMIN', 'staff', true, true, true, NOW()),
  ('ADMIN', 'cash', true, true, true, NOW()),
  ('ADMIN', 'cash_admin', true, true, true, NOW()),
  ('ADMIN', 'equipment', true, true, true, NOW()),
  ('ADMIN', 'permits', true, true, true, NOW()),
  ('ADMIN', 'tasks', true, true, true, NOW()),
  ('ADMIN', 'reports', true, true, true, NOW()),
  ('ADMIN', 'users', true, true, true, NOW()),
  ('ADMIN', 'settings', true, true, true, NOW()),
  ('PM', 'tenders', true, true, false, NOW()),
  ('PM', 'works', true, true, false, NOW()),
  ('PM', 'staff', true, true, false, NOW()),
  ('PM', 'cash', true, true, false, NOW()),
  ('PM', 'equipment', true, false, false, NOW()),
  ('PM', 'tasks', true, true, false, NOW()),
  ('PM', 'reports', true, false, false, NOW()),
  ('TO', 'tenders', true, true, false, NOW()),
  ('TO', 'works', true, false, false, NOW()),
  ('TO', 'reports', true, false, false, NOW()),
  ('TO', 'tasks', true, true, false, NOW()),
  ('BUH', 'cash', true, false, false, NOW()),
  ('BUH', 'cash_admin', true, false, false, NOW()),
  ('BUH', 'works', true, false, false, NOW()),
  ('BUH', 'reports', true, true, false, NOW()),
  ('BUH', 'tasks', true, true, false, NOW()),
  ('HR', 'staff', true, true, false, NOW()),
  ('HR', 'permits', true, true, false, NOW()),
  ('HR', 'works', true, false, false, NOW()),
  ('HR', 'tasks', true, true, false, NOW()),
  ('HR', 'reports', true, false, false, NOW()),
  ('OFFICE_MANAGER', 'tasks', true, true, false, NOW()),
  ('OFFICE_MANAGER', 'reports', true, false, false, NOW()),
  ('WAREHOUSE', 'equipment', true, true, false, NOW()),
  ('WAREHOUSE', 'tasks', true, true, false, NOW()),
  ('PROC', 'equipment', true, true, false, NOW()),
  ('PROC', 'tasks', true, true, false, NOW()),
  ('HEAD_PM', 'tenders', true, true, false, NOW()),
  ('HEAD_PM', 'works', true, true, false, NOW()),
  ('HEAD_PM', 'staff', true, true, false, NOW()),
  ('HEAD_PM', 'cash', true, true, false, NOW()),
  ('HEAD_PM', 'equipment', true, false, false, NOW()),
  ('HEAD_PM', 'tasks', true, true, false, NOW()),
  ('HEAD_PM', 'reports', true, false, false, NOW()),
  ('HEAD_TO', 'tenders', true, true, false, NOW()),
  ('HEAD_TO', 'works', true, false, false, NOW()),
  ('HEAD_TO', 'tasks', true, true, false, NOW()),
  ('HEAD_TO', 'reports', true, false, false, NOW()),
  ('HR_MANAGER', 'staff', true, true, false, NOW()),
  ('HR_MANAGER', 'permits', true, true, false, NOW()),
  ('HR_MANAGER', 'works', true, false, false, NOW()),
  ('HR_MANAGER', 'tasks', true, true, false, NOW()),
  ('HR_MANAGER', 'reports', true, false, false, NOW()),
  ('CHIEF_ENGINEER', 'equipment', true, true, false, NOW()),
  ('CHIEF_ENGINEER', 'tasks', true, true, false, NOW()),
  ('CHIEF_ENGINEER', 'works', true, false, false, NOW()),
  ('DIRECTOR_GEN', 'tenders', true, true, true, NOW()),
  ('DIRECTOR_GEN', 'works', true, true, true, NOW()),
  ('DIRECTOR_GEN', 'staff', true, true, true, NOW()),
  ('DIRECTOR_GEN', 'cash', true, true, true, NOW()),
  ('DIRECTOR_GEN', 'cash_admin', true, true, true, NOW()),
  ('DIRECTOR_GEN', 'equipment', true, true, true, NOW()),
  ('DIRECTOR_GEN', 'permits', true, true, true, NOW()),
  ('DIRECTOR_GEN', 'tasks', true, true, true, NOW()),
  ('DIRECTOR_GEN', 'reports', true, true, true, NOW()),
  ('DIRECTOR_GEN', 'users', true, true, true, NOW()),
  ('DIRECTOR_GEN', 'settings', true, true, true, NOW()),
  ('DIRECTOR_COMM', 'tenders', true, true, false, NOW()),
  ('DIRECTOR_COMM', 'works', true, true, false, NOW()),
  ('DIRECTOR_COMM', 'staff', true, true, false, NOW()),
  ('DIRECTOR_COMM', 'cash', true, true, false, NOW()),
  ('DIRECTOR_COMM', 'equipment', true, false, false, NOW()),
  ('DIRECTOR_COMM', 'tasks', true, true, false, NOW()),
  ('DIRECTOR_COMM', 'reports', true, true, false, NOW()),
  ('DIRECTOR_DEV', 'tenders', true, true, false, NOW()),
  ('DIRECTOR_DEV', 'works', true, true, false, NOW()),
  ('DIRECTOR_DEV', 'staff', true, true, false, NOW()),
  ('DIRECTOR_DEV', 'cash', true, true, false, NOW()),
  ('DIRECTOR_DEV', 'equipment', true, false, false, NOW()),
  ('DIRECTOR_DEV', 'tasks', true, true, false, NOW()),
  ('DIRECTOR_DEV', 'reports', true, true, false, NOW())
ON CONFLICT (role, module_key) DO NOTHING;

-- Default modules
INSERT INTO modules (key, name, is_active, sort_order) VALUES
  ('tenders', 'Тендеры', true, 1),
  ('works', 'Работы', true, 2),
  ('staff', 'Персонал', true, 3),
  ('cash', 'Касса', true, 4),
  ('cash_admin', 'Касса (управление)', true, 5),
  ('equipment', 'Оборудование', true, 6),
  ('permits', 'Допуски', true, 7),
  ('tasks', 'Задачи', true, 8),
  ('reports', 'Отчёты', true, 9),
  ('users', 'Пользователи', true, 10),
  ('settings', 'Настройки', true, 11)
ON CONFLICT (key) DO NOTHING;

-- =========================================================================
-- DONE
-- =========================================================================
