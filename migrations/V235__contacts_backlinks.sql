-- V235__contacts_backlinks.sql
-- Wave 1, v3 канбан: контактные поля в inbox_applications/tenders/works
-- + обратные ссылки tenders.source_pre_tender_id, works.source_pre_tender_id
-- + backfill из pre_tender_requests → tenders

-- inbox_applications: добавить контактные поля для drawer
ALTER TABLE inbox_applications
  ADD COLUMN IF NOT EXISTS customer_inn       VARCHAR(12),
  ADD COLUMN IF NOT EXISTS customer_name      VARCHAR(500),
  ADD COLUMN IF NOT EXISTS contact_person     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone      VARCHAR(100),
  ADD COLUMN IF NOT EXISTS customer_email     VARCHAR(255),
  ADD COLUMN IF NOT EXISTS customer_city      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS customer_address   TEXT;

-- tenders: контактные поля + обратные ссылки на источники
ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS contact_person              VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone               VARCHAR(100),
  ADD COLUMN IF NOT EXISTS customer_email              VARCHAR(255),
  ADD COLUMN IF NOT EXISTS customer_city               VARCHAR(255),
  ADD COLUMN IF NOT EXISTS customer_address            TEXT,
  ADD COLUMN IF NOT EXISTS source_inbox_application_id INTEGER
    REFERENCES inbox_applications(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_pre_tender_id        INTEGER
    REFERENCES pre_tender_requests(id) ON DELETE SET NULL;

-- works: контактные поля + обратные ссылки
ALTER TABLE works
  ADD COLUMN IF NOT EXISTS customer_inn                VARCHAR(12),
  ADD COLUMN IF NOT EXISTS contact_person              VARCHAR(255),
  ADD COLUMN IF NOT EXISTS contact_phone               VARCHAR(100),
  ADD COLUMN IF NOT EXISTS customer_email              VARCHAR(255),
  ADD COLUMN IF NOT EXISTS source_pre_tender_id        INTEGER
    REFERENCES pre_tender_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_inbox_application_id INTEGER
    REFERENCES inbox_applications(id) ON DELETE SET NULL;

-- Backfill: проставить tenders.source_pre_tender_id из pre_tender_requests.created_tender_id
-- + скопировать контактные данные если их ещё нет
UPDATE tenders t
   SET source_pre_tender_id = pt.id,
       contact_person  = COALESCE(t.contact_person,  pt.contact_person),
       contact_phone   = COALESCE(t.contact_phone,   pt.contact_phone),
       customer_email  = COALESCE(t.customer_email,  pt.customer_email)
  FROM pre_tender_requests pt
 WHERE pt.created_tender_id = t.id
   AND t.source_pre_tender_id IS NULL;

-- Backfill: works.source_pre_tender_id через works.tender_id → tenders.source_pre_tender_id
UPDATE works w
   SET source_pre_tender_id = t.source_pre_tender_id
  FROM tenders t
 WHERE w.tender_id = t.id
   AND t.source_pre_tender_id IS NOT NULL
   AND w.source_pre_tender_id IS NULL;

-- Партиал-индексы для быстрого поиска источника карточки
CREATE INDEX IF NOT EXISTS idx_tenders_source_pretender
  ON tenders(source_pre_tender_id) WHERE source_pre_tender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_works_source_pretender
  ON works(source_pre_tender_id) WHERE source_pre_tender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenders_source_inbox
  ON tenders(source_inbox_application_id) WHERE source_inbox_application_id IS NOT NULL;
