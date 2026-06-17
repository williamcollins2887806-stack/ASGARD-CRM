-- V227 — backfill ALTER'ов tkp, которые на проде уже применены вручную, но миграции для них нет.
-- Источник: D-135 в _DIFF-LEDGER.md (2026-06-17).
-- Idempotent: все ADD COLUMN IF NOT EXISTS. Типы и default'ы verbatim с прод-схемы asgard_crm.

ALTER TABLE tkp ADD COLUMN IF NOT EXISTS tkp_type                 VARCHAR(50);
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS link_type                VARCHAR(32) NOT NULL DEFAULT 'standalone';
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS pre_tender_id            INTEGER;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS purpose_reason           TEXT;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS client_decision          VARCHAR(32);
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS client_decision_at       TIMESTAMP WITH TIME ZONE;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS client_decision_by       INTEGER;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS client_decision_comment  TEXT;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS attachment_path          VARCHAR(500);
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS attachment_mime          VARCHAR(100);
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS attachment_original_name VARCHAR(500);
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS attachment_size          BIGINT;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS parsed_from_attachment   BOOLEAN DEFAULT false;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS mimir_quick_session_uid  TEXT;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS payment_terms            TEXT;
