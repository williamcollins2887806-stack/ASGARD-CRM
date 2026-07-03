-- V266: расширить check-constraint pre_tender_requests.source_type
-- Форма «Создать заявку вручную» (personal_kanban) шлёт канал заявки:
--   phone / meeting / email / referral / website / other,
-- а старый констрейнт разрешал только email/manual/platform → INSERT падал 500
-- (pre_tender_requests_source_type_check, code 23514).
-- Синхронизируем БД с whitelist из src/routes/pre_tenders.js (ALLOWED_SOURCE_TYPES).
ALTER TABLE pre_tender_requests
  DROP CONSTRAINT IF EXISTS pre_tender_requests_source_type_check;

ALTER TABLE pre_tender_requests
  ADD CONSTRAINT pre_tender_requests_source_type_check
  CHECK (source_type::text = ANY (ARRAY[
    'email', 'manual', 'platform',
    'phone', 'meeting', 'referral', 'website', 'other'
  ]::text[]));
