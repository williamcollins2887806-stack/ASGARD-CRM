-- V252: Расширить correspondence под модуль «Официальная переписка»
-- + добавить FK для email_id и documents.correspondence_id, индексы для быстрых
-- выборок по тендеру/работе/просчёту/заявке, pg_trgm для fuzzy match
-- addendum_response intent.
--
-- Контекст (см. tests/reports/letters/_LETTER_CONTRACT.md §2 V252):
--   * 27 ADD COLUMN IF NOT EXISTS — идемпотентно, повторное применение не падает.
--   * letter_kind, signing_status — CHECK constraints с whitelist (см. §3, §8).
--   * Финализация (signing_status='finalized') и отправка (='sent') — гарды в
--     бэкенде src/services/correspondence.js (V252 только описывает structure).
--   * version_no + parent_correspondence_id + is_current — линковка редакций
--     письма (см. _LETTER_CONTRACT.md §8 state machine).
--   * signer_snapshot jsonb — снапшот подписанта на момент финализации,
--     не FK на users ([[_DECISIONS]] #4).
--   * deleted_at/deleted_by — soft delete (только ADMIN/DIRECTOR_GEN, §5 RBAC).
--   * FK для email_id и documents.correspondence_id — раньше были INTEGER без
--     REFERENCES, V252 добавляет констрейнты через DO $$ … IF NOT EXISTS блок.
--   * 7 partial индексов по (entity, direction, date DESC) с WHERE deleted_at
--     IS NULL — поддерживают быстрый список «всё по тендеру/работе/calc/pre_tender»
--     без сканирования удалённых строк.
--   * pg_trgm extension + GIN-индекс на tenders.tender_title — для fuzzy match
--     в imap.js при classification='addendum_response' (см. §6.3).
--
-- Безопасно: только ADD COLUMN/ADD CONSTRAINT/CREATE INDEX/CREATE EXTENSION.
-- Никаких изменений данных, кроме DEFAULT'ов для существующих строк
-- (letter_kind='free', signature_on=TRUE, stamp_on=TRUE, signing_status='draft',
-- version_no=1, is_current=TRUE).

BEGIN;

-- Новые колонки
ALTER TABLE correspondence
  ADD COLUMN IF NOT EXISTS body_html          TEXT,
  ADD COLUMN IF NOT EXISTS body_json          JSONB,                -- TipTap doc
  ADD COLUMN IF NOT EXISTS letter_kind        VARCHAR(50)
        DEFAULT 'free'
        CHECK (letter_kind IN ('clarification','request','response','notification',
                               'claim','warranty','cover','information','free')),
  ADD COLUMN IF NOT EXISTS doc_title          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS doc_sub            TEXT,
  ADD COLUMN IF NOT EXISTS header_subline     TEXT,
  ADD COLUMN IF NOT EXISTS procedure_number   VARCHAR(100),
  ADD COLUMN IF NOT EXISTS lot_number         VARCHAR(100),
  ADD COLUMN IF NOT EXISTS lot_title          TEXT,
  ADD COLUMN IF NOT EXISTS calc_id            INTEGER REFERENCES estimates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pre_tender_id      INTEGER REFERENCES pre_tender_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS conductor_run_id   INTEGER,  -- без FK (Conductor чистит сам)
  ADD COLUMN IF NOT EXISTS signer_snapshot    JSONB,    -- {name, full_name, position, org}
  ADD COLUMN IF NOT EXISTS signature_on       BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS stamp_on           BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS ai_model           VARCHAR(50),  -- gpt-5.5 / gpt-5.4 / grok-4.20-fast
  ADD COLUMN IF NOT EXISTS ai_thread_id       INTEGER REFERENCES mimir_conversations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_tokens_used     INTEGER,
  ADD COLUMN IF NOT EXISTS signing_status     VARCHAR(20)
        DEFAULT 'draft'
        CHECK (signing_status IN ('draft','finalized','sent')),
  ADD COLUMN IF NOT EXISTS version_no         INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS parent_correspondence_id INTEGER REFERENCES correspondence(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_current         BOOLEAN DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS revision_note      TEXT,
  ADD COLUMN IF NOT EXISTS deleted_at         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS deleted_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS finalized_at       TIMESTAMP,
  ADD COLUMN IF NOT EXISTS sent_at            TIMESTAMP;

-- Cleanup осиротевших ссылок (Finding F-1 от S-1/IMP).
-- До V252 documents.correspondence_id и correspondence.email_id были INTEGER без
-- REFERENCES. За время эксплуатации могли накопиться строки, ссылающиеся на уже
-- удалённые correspondence/emails. PostgreSQL ADD CONSTRAINT REFERENCES (без
-- NOT VALID) валидирует ВСЕ существующие строки и падает на первом орфане.
-- NULL-ификация безопасна: целевая запись уже удалена, восстановить связь
-- невозможно ничем кроме руки. Идемпотентно (повторное применение → 0 rows).
UPDATE documents
   SET correspondence_id = NULL
 WHERE correspondence_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM correspondence c WHERE c.id = documents.correspondence_id);

UPDATE correspondence
   SET email_id = NULL
 WHERE email_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM emails e WHERE e.id = correspondence.email_id);

-- FK для email_id (раньше был INTEGER без REFERENCES)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'correspondence_email_id_fkey'
      AND table_name = 'correspondence'
  ) THEN
    ALTER TABLE correspondence
      ADD CONSTRAINT correspondence_email_id_fkey
      FOREIGN KEY (email_id) REFERENCES emails(id) ON DELETE SET NULL;
  END IF;
END $$;

-- FK для documents.correspondence_id (раньше был INTEGER без REFERENCES)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'documents_correspondence_id_fkey'
      AND table_name = 'documents'
  ) THEN
    ALTER TABLE documents
      ADD CONSTRAINT documents_correspondence_id_fkey
      FOREIGN KEY (correspondence_id) REFERENCES correspondence(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Индексы для быстрых выборок «все письма по тендеру/работе/просчёту/заявке»
CREATE INDEX IF NOT EXISTS idx_correspondence_tender_dir_date
  ON correspondence (tender_id, direction, date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_correspondence_work_dir_date
  ON correspondence (work_id, direction, date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_correspondence_calc_dir_date
  ON correspondence (calc_id, direction, date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_correspondence_pre_tender_dir_date
  ON correspondence (pre_tender_id, direction, date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_correspondence_active_date
  ON correspondence (date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_correspondence_signing_status
  ON correspondence (signing_status, date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_correspondence_parent
  ON correspondence (parent_correspondence_id)
  WHERE parent_correspondence_id IS NOT NULL;

-- pg_trgm для fuzzy match в addendum_response intent
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_tenders_title_trgm
  ON tenders USING gin (tender_title gin_trgm_ops);

COMMIT;
