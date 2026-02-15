-- V032: TKP, Pass Requests, TMC Requests + Notification link_hash
-- ================================================================

-- Добавляем link_hash к notifications (если нет)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='notifications' AND column_name='link_hash') THEN
    ALTER TABLE notifications ADD COLUMN link_hash TEXT;
  END IF;
END $$;

-- ТКП (Технико-коммерческое предложение)
CREATE TABLE IF NOT EXISTS tkp (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER REFERENCES tenders(id),
  number TEXT,
  customer_name TEXT,
  customer_inn TEXT,
  contact_person TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  subject TEXT,
  items JSONB DEFAULT '[]',
  total_sum NUMERIC(15,2) DEFAULT 0,
  discount_percent NUMERIC(5,2) DEFAULT 0,
  final_sum NUMERIC(15,2) DEFAULT 0,
  valid_until DATE,
  status TEXT DEFAULT 'Черновик',
  sent_at TIMESTAMPTZ,
  sent_via TEXT,
  pdf_path TEXT,
  notes TEXT,
  author_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Заявки на пропуск
CREATE TABLE IF NOT EXISTS pass_requests (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER REFERENCES tenders(id),
  work_id INTEGER,
  object_name TEXT,
  object_address TEXT,
  request_type TEXT DEFAULT 'Пропуск',
  workers JSONB DEFAULT '[]',
  vehicles JSONB DEFAULT '[]',
  date_from DATE,
  date_to DATE,
  status TEXT DEFAULT 'Черновик',
  pdf_path TEXT,
  notes TEXT,
  author_id INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Заявки на ТМЦ
CREATE TABLE IF NOT EXISTS tmc_requests (
  id SERIAL PRIMARY KEY,
  work_id INTEGER,
  tender_id INTEGER REFERENCES tenders(id),
  request_type TEXT DEFAULT 'import',
  items JSONB DEFAULT '[]',
  total_sum NUMERIC(15,2) DEFAULT 0,
  status TEXT DEFAULT 'Черновик',
  supplier TEXT,
  delivery_date DATE,
  notes TEXT,
  author_id INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_tkp_tender ON tkp(tender_id);
CREATE INDEX IF NOT EXISTS idx_tkp_status ON tkp(status);
CREATE INDEX IF NOT EXISTS idx_pass_requests_tender ON pass_requests(tender_id);
CREATE INDEX IF NOT EXISTS idx_pass_requests_status ON pass_requests(status);
CREATE INDEX IF NOT EXISTS idx_tmc_requests_work ON tmc_requests(work_id);
CREATE INDEX IF NOT EXISTS idx_tmc_requests_status ON tmc_requests(status);
CREATE INDEX IF NOT EXISTS idx_notifications_link_hash ON notifications(link_hash);
