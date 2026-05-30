-- ═══════════════════════════════════════════════════════════════════════════
-- Mimir Conductor Refactor — Сессия 1, Шаг 1.1
-- V137 (план: V135): уточнения от агентов — вопросы к РП или к заказчику.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mimir_clarifications (
  id              BIGSERIAL PRIMARY KEY,
  conductor_run_id BIGINT NOT NULL REFERENCES mimir_conductor_runs(id) ON DELETE CASCADE,
  raised_by_agent_run_id BIGINT NOT NULL REFERENCES mimir_agent_runs(id),

  channel         TEXT NOT NULL,         -- 'CUSTOMER', 'PM', 'AUTO'
  category        TEXT,                  -- 'scope', 'access', 'docs', 'materials', 'timing', 'pricing'

  question_ru     TEXT NOT NULL,
  context_ref     TEXT,                  -- "поз. 14 ВО, стр. 3"
  why_we_ask      TEXT,                  -- зачем нужен ответ
  consequence     TEXT,                  -- что будет если не ответить
  options_json    JSONB,                 -- варианты ответа (если есть)
  impact_rub      NUMERIC(10,2),         -- оценка влияния на смету
  blocking        BOOLEAN NOT NULL DEFAULT true,
  default_assumption JSONB,              -- если не блокирующий — что приняли по умолчанию

  status          TEXT NOT NULL DEFAULT 'OPEN',
    -- OPEN, ANSWERED, ASSUMPTION_ACCEPTED, ESCALATED, EXPIRED, CANCELLED

  -- Ответ
  answer_text     TEXT,
  answered_by     BIGINT REFERENCES users(id),
  answered_at     TIMESTAMPTZ,
  answer_source   TEXT,                  -- 'pm_chat', 'customer_letter', 'customer_text_paste'
  answer_letter_id BIGINT,               -- ссылка на mimir_customer_letters если ответ из письма

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  due_at          TIMESTAMPTZ            -- дедлайн (для эскалации)
);

CREATE INDEX IF NOT EXISTS idx_mcl_run         ON mimir_clarifications(conductor_run_id);
CREATE INDEX IF NOT EXISTS idx_mcl_channel     ON mimir_clarifications(channel, status);
CREATE INDEX IF NOT EXISTS idx_mcl_status      ON mimir_clarifications(status);
