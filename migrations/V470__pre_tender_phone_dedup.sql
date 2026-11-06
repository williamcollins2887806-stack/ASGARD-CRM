-- V470: дедуп заявок из звонков по номеру клиента.
-- Один клиент = одна заявка маркетплейса (pre_tender_requests) с историей звонков.
-- Индекс ускоряет поиск «живой» заявки клиента за 30 дней.

CREATE INDEX IF NOT EXISTS idx_pre_tender_phone_dedup
  ON pre_tender_requests (right(regexp_replace(COALESCE(contact_phone, ''), '\D', '', 'g'), 10))
  WHERE source_type = 'phone';

COMMENT ON INDEX idx_pre_tender_phone_dedup IS
  'V470: поиск заявки из звонка по нормализованному телефону клиента (дедуп).';
