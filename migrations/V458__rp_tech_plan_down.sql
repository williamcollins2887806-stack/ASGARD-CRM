-- V458 down: убрать техплан просчёта.
--
-- Данные в asgard_smeta (rows, crew, mtr) НЕ трогаются: откат колонки не
-- должен крушить просчёты. После отката техплан живёт только внутри
-- report_json.asgard_smeta, как до миграции.

DROP INDEX IF EXISTS idx_tender_rp_reviews_tech_json;

ALTER TABLE tender_rp_reviews
  DROP COLUMN IF EXISTS tech_json;
