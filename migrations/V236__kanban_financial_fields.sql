-- V236__kanban_financial_fields.sql
-- Wave 1, v3 канбан: финансовые поля + last_status_change_at для сортировки
-- + триггеры на смену статуса

-- pre_tender_requests: финансы для drawer «Финансы»
ALTER TABLE pre_tender_requests
  ADD COLUMN IF NOT EXISTS cost_planned          NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS kp_price_without_vat  NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS kp_price_with_vat     NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS vat_rate_pct          NUMERIC(5,2) DEFAULT 20,
  ADD COLUMN IF NOT EXISTS margin_planned_pct    NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ DEFAULT NOW();

-- tenders: финансы + last_status_change_at + кэш дат win/lose/kp_sent
ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS cost_planned          NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS kp_price_without_vat  NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS kp_price_with_vat     NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS vat_rate_pct          NUMERIC(5,2) DEFAULT 20,
  ADD COLUMN IF NOT EXISTS margin_planned_pct    NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS last_status_change_at TIMESTAMPTZ DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS kp_sent_at            TIMESTAMPTZ;

-- ВНИМАНИЕ: tenders.won_at / lost_at уже добавлены в V117 — не дублируем.
-- (V117__tenders_win_lose_workflow.sql)

-- Триггер: автоматически обновлять last_status_change_at в tenders при смене tender_status
CREATE OR REPLACE FUNCTION trg_tenders_status_change_ts() RETURNS trigger AS $$
BEGIN
  IF NEW.tender_status IS DISTINCT FROM OLD.tender_status THEN
    NEW.last_status_change_at := NOW();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_tenders_status_change_ts ON tenders;
CREATE TRIGGER trg_tenders_status_change_ts BEFORE UPDATE ON tenders
  FOR EACH ROW EXECUTE FUNCTION trg_tenders_status_change_ts();

-- Триггер: то же для pre_tender_requests
CREATE OR REPLACE FUNCTION trg_pretender_status_change_ts() RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.last_status_change_at := NOW();
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_pretender_status_change_ts ON pre_tender_requests;
CREATE TRIGGER trg_pretender_status_change_ts BEFORE UPDATE ON pre_tender_requests
  FOR EACH ROW EXECUTE FUNCTION trg_pretender_status_change_ts();

-- Backfill last_status_change_at = updated_at для существующих записей
UPDATE pre_tender_requests SET last_status_change_at = updated_at
WHERE last_status_change_at IS NULL AND updated_at IS NOT NULL;
UPDATE tenders SET last_status_change_at = updated_at
WHERE last_status_change_at IS NULL AND updated_at IS NOT NULL;
