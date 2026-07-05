-- V270: Реестр тендеров ТО — registry_status, дежурства РП, отчёты, TenderGuru candidates

-- 1. registry_status на tenders
ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS registry_status VARCHAR(20) NOT NULL DEFAULT 'рассмотрение';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenders_registry_status_check') THEN
    ALTER TABLE tenders ADD CONSTRAINT tenders_registry_status_check
      CHECK (registry_status IN ('рассмотрение','готовим','подались','проиграли','отмена','выиграли'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenders_registry_status ON tenders(registry_status);

-- 2. Расширить source_kind: tenderguru
ALTER TABLE tenders DROP CONSTRAINT IF EXISTS tenders_source_kind_check;
ALTER TABLE tenders ADD CONSTRAINT tenders_source_kind_check
  CHECK (source_kind IN (
    'manual','platform','email_invite','email_request','phone',
    'pm_manual','to_manual','tenderguru'
  ));

-- 3. Дежурства РП
CREATE TABLE IF NOT EXISTS pm_duty_roster (
  id SERIAL PRIMARY KEY,
  pm_user_id INTEGER NOT NULL REFERENCES users(id),
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  assigned_by_user_id INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pm_duty_roster_period_check CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS idx_pm_duty_roster_period ON pm_duty_roster(period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_pm_duty_roster_pm ON pm_duty_roster(pm_user_id);

-- 4. Отчёты РП по тендеру
CREATE TABLE IF NOT EXISTS tender_rp_reviews (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER NOT NULL UNIQUE REFERENCES tenders(id) ON DELETE CASCADE,
  decision VARCHAR(20) NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','submit','reject')),
  report_kind VARCHAR(20) CHECK (report_kind IN ('reject','work')),
  report_json JSONB NOT NULL DEFAULT '{}',
  missing_info_flags TEXT[] NOT NULL DEFAULT '{}',
  estimate_file_id INTEGER,
  work_price NUMERIC(18,2),
  is_final BOOLEAN NOT NULL DEFAULT false,
  started_by_user_id INTEGER REFERENCES users(id),
  finalized_by_user_id INTEGER REFERENCES users(id),
  calculator_user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tender_rp_reviews_tender ON tender_rp_reviews(tender_id);
CREATE INDEX IF NOT EXISTS idx_tender_rp_reviews_final ON tender_rp_reviews(is_final);

-- 5. Журнал действий по отчёту
CREATE TABLE IF NOT EXISTS tender_rp_review_log (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES tender_rp_reviews(id) ON DELETE CASCADE,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  actor_user_id INTEGER REFERENCES users(id),
  action VARCHAR(40) NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tender_rp_review_log_review ON tender_rp_review_log(review_id);
CREATE INDEX IF NOT EXISTS idx_tender_rp_review_log_tender ON tender_rp_review_log(tender_id);

-- 6. Коллабораторы (привлечение РП)
CREATE TABLE IF NOT EXISTS tender_rp_review_collaborators (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES tender_rp_reviews(id) ON DELETE CASCADE,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  pm_user_id INTEGER NOT NULL REFERENCES users(id),
  invited_by_user_id INTEGER NOT NULL REFERENCES users(id),
  invited_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  UNIQUE (review_id, pm_user_id)
);

CREATE INDEX IF NOT EXISTS idx_rp_collab_pm ON tender_rp_review_collaborators(pm_user_id)
  WHERE revoked_at IS NULL;

-- 7. Кандидаты TenderGuru
CREATE TABLE IF NOT EXISTS tenderguru_candidates (
  id SERIAL PRIMARY KEY,
  external_id VARCHAR(100),
  title TEXT,
  customer_name TEXT,
  customer_inn VARCHAR(20),
  nmc NUMERIC(18,2),
  deadline DATE,
  purchase_url TEXT,
  raw_json JSONB NOT NULL DEFAULT '{}',
  matched_tender_id INTEGER REFERENCES tenders(id),
  status VARCHAR(20) NOT NULL DEFAULT 'new'
    CHECK (status IN ('new','accepted','duplicate','dismissed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenderguru_candidates_status ON tenderguru_candidates(status);
CREATE INDEX IF NOT EXISTS idx_tenderguru_candidates_external ON tenderguru_candidates(external_id);

-- Backfill registry_status from tender_status for existing rows
UPDATE tenders SET registry_status = CASE
  WHEN tender_status = 'Выиграли' THEN 'выиграли'
  WHEN tender_status = 'Проиграли' THEN 'проиграли'
  WHEN tender_status = 'Не подходит' THEN 'отмена'
  WHEN tender_status IN ('КП отправлено','Дозапрос') THEN 'подались'
  WHEN tender_status IN ('Отправлено на просчёт','Согласование ТКП','ТКП согласовано','Готово к отправке КП') THEN 'готовим'
  ELSE 'рассмотрение'
END
WHERE registry_status = 'рассмотрение' AND tender_status IS NOT NULL;
