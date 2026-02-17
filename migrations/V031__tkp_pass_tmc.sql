-- V031: Создание таблиц tkp, pass_requests, tmc_requests
-- ТКП (технико-коммерческие предложения), заявки на пропуска, заявки на ТМЦ

-- ═══════════════════════════════════════════════════════
-- 1. tkp — Технико-коммерческие предложения
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tkp (
  id            SERIAL PRIMARY KEY,
  subject       VARCHAR(500) NOT NULL,
  tender_id     INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
  work_id       INTEGER REFERENCES works(id) ON DELETE SET NULL,
  customer_name VARCHAR(500),
  contact_email VARCHAR(255),
  items         JSONB NOT NULL DEFAULT '{}',
  services      TEXT,
  total_sum     NUMERIC(14,2) NOT NULL DEFAULT 0,
  deadline      VARCHAR(100),
  validity_days INTEGER NOT NULL DEFAULT 30,
  status        VARCHAR(20) NOT NULL DEFAULT 'draft',
  author_id     INTEGER NOT NULL REFERENCES users(id),
  sent_at       TIMESTAMP,
  sent_by       INTEGER REFERENCES users(id),
  pdf_path      VARCHAR(500),
  created_at    TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tkp_author    ON tkp(author_id);
CREATE INDEX IF NOT EXISTS idx_tkp_tender    ON tkp(tender_id);
CREATE INDEX IF NOT EXISTS idx_tkp_status    ON tkp(status);

-- ═══════════════════════════════════════════════════════
-- 2. pass_requests — Заявки на пропуска
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pass_requests (
  id              SERIAL PRIMARY KEY,
  work_id         INTEGER REFERENCES works(id) ON DELETE SET NULL,
  object_name     VARCHAR(500) NOT NULL,
  date_from       DATE NOT NULL,
  date_to         DATE NOT NULL,
  workers         JSONB NOT NULL DEFAULT '[]',
  vehicles        JSONB NOT NULL DEFAULT '[]',
  equipment_json  JSONB NOT NULL DEFAULT '[]',
  contact_person  VARCHAR(255),
  contact_phone   VARCHAR(50),
  notes           TEXT,
  author_id       INTEGER NOT NULL REFERENCES users(id),
  status          VARCHAR(20) NOT NULL DEFAULT 'draft',
  approved_by     INTEGER REFERENCES users(id),
  approved_at     TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pass_requests_author ON pass_requests(author_id);
CREATE INDEX IF NOT EXISTS idx_pass_requests_work   ON pass_requests(work_id);
CREATE INDEX IF NOT EXISTS idx_pass_requests_status ON pass_requests(status);

-- ═══════════════════════════════════════════════════════
-- 3. tmc_requests — Заявки на ТМЦ (товарно-материальные ценности)
-- ═══════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tmc_requests (
  id                SERIAL PRIMARY KEY,
  work_id           INTEGER REFERENCES works(id) ON DELETE SET NULL,
  title             VARCHAR(500) NOT NULL,
  items             JSONB NOT NULL DEFAULT '[]',
  total_sum         NUMERIC(14,2) NOT NULL DEFAULT 0,
  priority          VARCHAR(20) NOT NULL DEFAULT 'normal',
  needed_by         DATE,
  delivery_address  VARCHAR(500),
  supplier          VARCHAR(500),
  notes             TEXT,
  author_id         INTEGER NOT NULL REFERENCES users(id),
  status            VARCHAR(20) NOT NULL DEFAULT 'draft',
  approved_by       INTEGER REFERENCES users(id),
  approved_at       TIMESTAMP,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tmc_requests_author ON tmc_requests(author_id);
CREATE INDEX IF NOT EXISTS idx_tmc_requests_work   ON tmc_requests(work_id);
CREATE INDEX IF NOT EXISTS idx_tmc_requests_status ON tmc_requests(status);
