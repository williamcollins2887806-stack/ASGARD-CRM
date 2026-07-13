-- V283: Порядковый № реестра + чат вопросов TO↔РП в отчёте

CREATE SEQUENCE IF NOT EXISTS tenders_registry_no_seq;

ALTER TABLE tenders ADD COLUMN IF NOT EXISTS registry_no INTEGER UNIQUE;

-- Backfill существующих тендеров
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id FROM tenders WHERE registry_no IS NULL ORDER BY created_at ASC, id ASC
  LOOP
    UPDATE tenders SET registry_no = nextval('tenders_registry_no_seq') WHERE id = r.id;
  END LOOP;
END $$;

ALTER TABLE tenders
  ALTER COLUMN registry_no SET DEFAULT nextval('tenders_registry_no_seq');

CREATE INDEX IF NOT EXISTS idx_tenders_registry_no ON tenders(registry_no);

-- Сообщения в чате отчёта РП
CREATE TABLE IF NOT EXISTS tender_rp_review_messages (
  id SERIAL PRIMARY KEY,
  review_id INTEGER NOT NULL REFERENCES tender_rp_reviews(id) ON DELETE CASCADE,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rp_review_messages_review ON tender_rp_review_messages(review_id, created_at);
CREATE INDEX IF NOT EXISTS idx_rp_review_messages_tender ON tender_rp_review_messages(tender_id, created_at);

CREATE TABLE IF NOT EXISTS tender_rp_review_message_files (
  id SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES tender_rp_review_messages(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rp_review_msg_files_msg ON tender_rp_review_message_files(message_id);

-- Прочитано в чате (per user per tender)
CREATE TABLE IF NOT EXISTS tender_rp_review_thread_seen (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tender_id INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_message_id INTEGER REFERENCES tender_rp_review_messages(id) ON DELETE SET NULL,
  PRIMARY KEY (user_id, tender_id)
);

CREATE INDEX IF NOT EXISTS idx_rp_review_thread_seen_tender ON tender_rp_review_thread_seen(tender_id);
