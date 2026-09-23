-- V358: D-246 — справочная активность в снапшоте рейтинга РП.
-- Зачем: недельный дайджест считает закрытые ПРОСЧЁТЫ (`tender_rp_review_log`:
-- action='finalize' AND payload_json->>'mode'='calc') отдельной плиткой. Рейтинг РП
-- оставался «слепым» к этой работе — теперь в снапшоте есть activity_json.closed_calc.
-- ВАЖНО: в score/grade не входит (у закрытия просчёта нет решения «подаём/не подаём»),
-- иначе числа рейтинга меняются молча.
-- Идемпотентно (ADD COLUMN IF NOT EXISTS).

ALTER TABLE pm_analysis_rating_daily ADD COLUMN IF NOT EXISTS activity_json JSONB;
