-- V486: очередь «уточнить клиента» для звонков, где контрагент не определился.
--
-- Зачем: до этой миграции звонок с неизвестного номера оставался безымянным
-- (client_inn NULL у всех 89 звонков). Теперь такие звонки попадают в очередь,
-- и человек за 5 секунд связывает их с контрагентом (или помечает «не клиент»).
--
-- Связывание проставляет client_inn не только текущему звонку, но и всем
-- прошлым звонкам того же номера — чтобы история собралась.

CREATE TABLE IF NOT EXISTS call_client_review (
  id                SERIAL PRIMARY KEY,
  call_history_id   INTEGER NOT NULL REFERENCES call_history(id) ON DELETE CASCADE,
  phone             VARCHAR(20),
  suggested_name    VARCHAR(500),
  status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'resolved', 'ignored')),
  resolved_inn      VARCHAR(12),
  resolved_by       INTEGER REFERENCES users(id),
  resolved_at       TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT call_client_review_unique_call UNIQUE (call_history_id)
);

CREATE INDEX IF NOT EXISTS idx_call_client_review_status
  ON call_client_review (status, created_at DESC)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_call_client_review_phone
  ON call_client_review (phone)
  WHERE phone IS NOT NULL;

COMMENT ON TABLE call_client_review IS
  'Очередь «уточнить клиента»: звонки, где ИИ и DaData не смогли определить контрагента';
COMMENT ON COLUMN call_client_review.resolved_inn IS
  'ИНН контрагента, выбранного вручную при разборе очереди';
