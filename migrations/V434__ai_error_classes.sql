-- ═══════════════════════════════════════════════════════════════════════════
-- V434: разделение ошибок ИИ на инфраструктурные и контентные (D-347)
-- ═══════════════════════════════════════════════════════════════════════════
-- ИНЦИДЕНТ 23.10.2026. Закончились деньги на ИИ-провайдере. Четыре письма со
-- счетами (#5011–#5014) упали с provider_error три раза подряд и навсегда
-- выпали из очереди: выборка берёт только `ai_attempts < 3`, а сброс фильтрует
-- тем же условием. Восстановления не было — только руками через SQL.
--
-- Корень: система наказывала ПИСЬМО за НАШУ проблему с провайдером.
-- Теперь ошибки делятся на два класса:
--   • инфраструктурные (нет денег, 5xx, таймаут, пустой ответ) — попытки НЕ
--     тратятся, письмо ждёт восстановления провайдера (потолок по ВОЗРАСТУ);
--   • контентные (битый JSON, нет классификации) — считаются как раньше.
--
-- Новые колонки:
--   ai_infra_failures   — сколько было инфраструктурных сбоев (для диагностики)
--   ai_last_error_class — 'infra' | 'content' — класс последней ошибки
--   ai_needs_manual     — человек взял письмо в работу, автоповторы прекращены

BEGIN;

ALTER TABLE emails
  ADD COLUMN IF NOT EXISTS ai_infra_failures   integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_last_error_class character varying(16),
  ADD COLUMN IF NOT EXISTS ai_needs_manual     boolean DEFAULT false;

-- Существующие письма, упавшие с provider_error, помечаем как инфраструктурные
-- и обнуляем попытки: их «потеряли» из-за нашего сбоя, а не из-за содержимого.
UPDATE emails
   SET ai_last_error_class = 'infra',
       ai_attempts = 0,
       ai_infra_failures = GREATEST(COALESCE(ai_infra_failures, 0), COALESCE(ai_attempts, 0))
 WHERE direction = 'inbound'
   AND is_deleted = false
   AND ai_processed_at IS NULL
   AND (
     ai_summary LIKE '%provider_error%'
     OR ai_summary LIKE '%empty_response%'
     OR ai_summary LIKE '%провайдер ИИ%'
     OR ai_summary LIKE '%timeout%'
   );

-- Индексы под выборку очереди.
CREATE INDEX IF NOT EXISTS idx_emails_ai_queue
  ON emails (email_date DESC)
  WHERE direction = 'inbound' AND is_deleted = false AND ai_processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_emails_ai_error_class
  ON emails (ai_last_error_class)
  WHERE ai_processed_at IS NULL AND direction = 'inbound';

COMMIT;

-- ПРОВЕРКА:
--   SELECT ai_last_error_class, count(*) FROM emails
--    WHERE direction='inbound' AND is_deleted=false AND ai_processed_at IS NULL
--    GROUP BY 1;
--   -- ожидание: infra → 5, content → 0
