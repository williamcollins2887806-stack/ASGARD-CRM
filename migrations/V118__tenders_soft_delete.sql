-- V118: soft delete для tenders
-- ──────────────────────────────────────────────────────────────────────────────
-- Проблема: src/services/mimir-data.js использует "WHERE deleted_at IS NULL"
-- в запросах к tenders (строки 131, 286), но колонки нет в БД.
-- Это даёт "DB stats error: column deleted_at does not exist" в логах
-- и Мимир не видит статистику по тендерам.
--
-- Решение: добавить deleted_at в tenders по образцу works/chat_messages.
-- IS NULL для всех существующих строк (=не удалено).

ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Партиционированный индекс — большинство запросов фильтрует WHERE deleted_at IS NULL
CREATE INDEX IF NOT EXISTS idx_tenders_not_deleted
  ON tenders(id)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN tenders.deleted_at IS 'Soft delete timestamp. NULL = активный тендер.';
