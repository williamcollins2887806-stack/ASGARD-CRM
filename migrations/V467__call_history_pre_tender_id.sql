-- V467: связь звонка с заявкой маркетплейса (pre_tender_requests),
-- вместо создания саги tenders из телефонии (source=phone_call).
-- lead_id оставляем для аудита старых записей.

ALTER TABLE call_history
  ADD COLUMN IF NOT EXISTS pre_tender_id INTEGER REFERENCES pre_tender_requests(id);

CREATE INDEX IF NOT EXISTS idx_call_history_pre_tender
  ON call_history (pre_tender_id)
  WHERE pre_tender_id IS NOT NULL;

COMMENT ON COLUMN call_history.pre_tender_id IS
  'V467: заявка маркетплейса (pre_tender_requests), созданная из целевого звонка.';
