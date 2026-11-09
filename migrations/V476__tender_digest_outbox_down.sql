-- Откат V476
DROP INDEX IF EXISTS idx_tender_digest_outbox_sent;
DROP INDEX IF EXISTS idx_tender_digest_outbox_pending;
DROP INDEX IF EXISTS idx_tender_digest_outbox_key;
DROP TABLE IF EXISTS tender_digest_outbox;
