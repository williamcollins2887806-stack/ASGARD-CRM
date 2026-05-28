-- V129: tkp_quick_sessions — сессия диалога с Мимиром для «Быстрого ТКП»
-- Хранит ТЗ, вложения, черновик сметы, историю чата и итоговую привязку к tkp.
-- Структурно повторяет mimir_estimate_jobs (V119), но заточена под ТКП-флоу.

CREATE TABLE IF NOT EXISTS tkp_quick_sessions (
  id                  SERIAL PRIMARY KEY,
  session_uid         TEXT UNIQUE NOT NULL,
  author_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  customer_inn        VARCHAR(12),
  customer_name       VARCHAR(500),
  customer_data       JSONB,
  pre_tender_id       INTEGER REFERENCES pre_tender_requests(id) ON DELETE SET NULL,
  tender_id           INTEGER REFERENCES tenders(id)            ON DELETE SET NULL,
  parent_work_id      INTEGER REFERENCES works(id)              ON DELETE SET NULL,
  tz_text             TEXT,
  tz_attachments      JSONB NOT NULL DEFAULT '[]',
  status              VARCHAR(32) NOT NULL DEFAULT 'draft',
  -- draft | calculating | questions | ready | finalized | error | abandoned
  error_text          TEXT,
  estimate_draft      JSONB,
  estimate_history    JSONB NOT NULL DEFAULT '[]',
  chat_messages       JSONB NOT NULL DEFAULT '[]',
  tkp_id              INTEGER REFERENCES tkp(id) ON DELETE SET NULL,
  total_input_tokens  INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalized_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tkp_quick_author_active
  ON tkp_quick_sessions(author_id, created_at DESC)
  WHERE status NOT IN ('finalized','abandoned');
CREATE INDEX IF NOT EXISTS idx_tkp_quick_pre_tender ON tkp_quick_sessions(pre_tender_id) WHERE pre_tender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tkp_quick_tender     ON tkp_quick_sessions(tender_id)     WHERE tender_id     IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tkp_quick_parent     ON tkp_quick_sessions(parent_work_id) WHERE parent_work_id IS NOT NULL;

COMMENT ON TABLE tkp_quick_sessions IS 'Сессии «Быстрого ТКП через Мимира»: ТЗ -> расчёт -> чат -> финализация в tkp';
