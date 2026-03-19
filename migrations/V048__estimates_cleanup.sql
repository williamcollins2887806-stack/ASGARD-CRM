-- V048: Estimates cleanup — drop dead tables, add index, add requires_payment, fix VAT

-- 1. Удаление GPT Codex артефактов (мёртвые таблицы)
-- ПРИМЕЧАНИЕ: estimate_approval_requests используется в hints.js (try/catch) —
-- при деплое обновить hints.js для использования новой системы (Сессия 2+)
DROP TABLE IF EXISTS approval_payment_slips CASCADE;
DROP TABLE IF EXISTS estimate_approval_events CASCADE;
DROP TABLE IF EXISTS estimate_approval_requests CASCADE;

-- 2. Индекс для основных запросов estimates
CREATE INDEX IF NOT EXISTS idx_estimates_tender_pm
  ON estimates(tender_id, pm_id);

-- 3. Колонка requires_payment на estimates
-- V044 добавляет requires_payment к estimate_approval_requests (другая таблица)
-- Здесь добавляем к estimates
ALTER TABLE estimates
  ADD COLUMN IF NOT EXISTS requires_payment BOOLEAN DEFAULT false;

-- 4. Убедиться что в settings.app есть vat_pct = 22
UPDATE settings SET value_json = jsonb_set(
  COALESCE(value_json, '{}')::jsonb, '{vat_pct}', '22'
) WHERE key = 'app';
