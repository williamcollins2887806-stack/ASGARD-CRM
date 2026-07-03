-- V266 down: вернуть старый констрейнт (email/manual/platform).
-- ВНИМАНИЕ: если в таблице уже есть строки с phone/meeting/referral/website/other,
-- откат упадёт — сначала перекодировать их в 'manual'.
ALTER TABLE pre_tender_requests
  DROP CONSTRAINT IF EXISTS pre_tender_requests_source_type_check;

ALTER TABLE pre_tender_requests
  ADD CONSTRAINT pre_tender_requests_source_type_check
  CHECK (source_type::text = ANY (ARRAY[
    'email', 'manual', 'platform'
  ]::text[]));
