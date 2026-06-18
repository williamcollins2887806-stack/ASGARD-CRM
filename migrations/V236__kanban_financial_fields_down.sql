-- V236 DOWN: откат финансовых полей и триггеров

DROP TRIGGER IF EXISTS trg_tenders_status_change_ts ON tenders;
DROP FUNCTION IF EXISTS trg_tenders_status_change_ts();

DROP TRIGGER IF EXISTS trg_pretender_status_change_ts ON pre_tender_requests;
DROP FUNCTION IF EXISTS trg_pretender_status_change_ts();

ALTER TABLE tenders
  DROP COLUMN IF EXISTS kp_sent_at,
  DROP COLUMN IF EXISTS last_status_change_at,
  DROP COLUMN IF EXISTS margin_planned_pct,
  DROP COLUMN IF EXISTS vat_rate_pct,
  DROP COLUMN IF EXISTS kp_price_with_vat,
  DROP COLUMN IF EXISTS kp_price_without_vat,
  DROP COLUMN IF EXISTS cost_planned;

ALTER TABLE pre_tender_requests
  DROP COLUMN IF EXISTS last_status_change_at,
  DROP COLUMN IF EXISTS margin_planned_pct,
  DROP COLUMN IF EXISTS vat_rate_pct,
  DROP COLUMN IF EXISTS kp_price_with_vat,
  DROP COLUMN IF EXISTS kp_price_without_vat,
  DROP COLUMN IF EXISTS cost_planned;
