-- V215: scoring рейтинга заказчика на основе истории событий.
-- Контекст: vanilla `updateCustomerScore` (tenders.js:2773) ходил в local-only
-- AsgardGeoScore. React v2 переводит scoring на backend — мы пишем события
-- в журнал и агрегируем их в customers.customer_score (1..5).

-- 1. Лог событий по заказчику (создание тендера, выигрыш, проигрыш, оплата и т.п.)
CREATE TABLE IF NOT EXISTS customer_score_events (
  id            BIGSERIAL PRIMARY KEY,
  customer_inn  VARCHAR(20) NOT NULL,
  event_type    VARCHAR(64) NOT NULL,
  amount        NUMERIC(18, 2),
  delta         NUMERIC(8, 3) NOT NULL DEFAULT 0,
  ref_type      VARCHAR(32),
  ref_id        BIGINT,
  meta          JSONB,
  created_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cse_inn_created
  ON customer_score_events(customer_inn, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cse_event_type
  ON customer_score_events(event_type);

-- 2. Кэш агрегированной оценки в самом customer (1..5, NULL если не считалось).
-- Хранится отдельно от dashboard'а — это быстрая численная оценка для UI-карточек.
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_score NUMERIC(3, 1);

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_score_updated_at TIMESTAMPTZ;
