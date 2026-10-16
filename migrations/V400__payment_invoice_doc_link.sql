-- ============================================================================
-- V400: страховка от дубля заявок на оплату по строке реестра.
-- ----------------------------------------------------------------------------
-- Контекст: N1 (гонка `quick action=pay`) закрыт транзакцией с FOR UPDATE, но
-- верификатор верно заметил: защиту стоит продублировать на уровне БД, чтобы
-- дубль был невозможен даже при будущей ошибке в приложении.
--
-- Решение: ссылка заявки на строку реестра + частичный UNIQUE по ней. Одна
-- строка реестра → максимум одна заявка на оплату.
-- Идемпотентно, аддитивно. Down — V400__..._down.sql.
-- ============================================================================

ALTER TABLE payment_invoices ADD COLUMN IF NOT EXISTS doc_registry_id INTEGER;

-- Backfill из существующей обратной ссылки.
UPDATE payment_invoices pi
   SET doc_registry_id = d.id
  FROM doc_registry d
 WHERE d.payment_invoice_id = pi.id
   AND pi.doc_registry_id IS NULL;

-- Частичный UNIQUE: по одной строке реестра — только одна заявка.
CREATE UNIQUE INDEX IF NOT EXISTS uq_pi_doc_registry
  ON payment_invoices (doc_registry_id)
  WHERE doc_registry_id IS NOT NULL;

COMMENT ON COLUMN payment_invoices.doc_registry_id IS
  'V400: строка реестра документов, из которой создана заявка (1:1, UNIQUE). '
  'Страховка от дублей при гонке (defense-in-depth к транзакции в quick action=pay).';
