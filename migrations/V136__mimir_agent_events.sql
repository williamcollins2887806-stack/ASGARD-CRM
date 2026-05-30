-- ═══════════════════════════════════════════════════════════════════════════
-- Mimir Conductor Refactor — Сессия 1, Шаг 1.1
-- V136 (план: V134): append-only лог событий каждого агента — мысли,
-- tool-calls, артефакты, статусы. Стримится в War Room UI (SSE) и хранится
-- навсегда для аудита.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mimir_agent_events (
  id              BIGSERIAL PRIMARY KEY,
  conductor_run_id BIGINT NOT NULL REFERENCES mimir_conductor_runs(id) ON DELETE CASCADE,
  agent_run_id    BIGINT REFERENCES mimir_agent_runs(id) ON DELETE CASCADE,

  event_type      TEXT NOT NULL,
    -- 'thought', 'tool_call', 'tool_result', 'artifact_emitted',
    -- 'status_change', 'cost_tick', 'clarification_raised', 'error'

  payload         JSONB NOT NULL,
    -- thought: { text: "..." }
    -- tool_call: { tool: "web_search", input: {...} }
    -- tool_result: { tool: "web_search", output_summary: "...", citations: [...] }
    -- artifact_emitted: { artifact_id, artifact_type }
    -- status_change: { from: 'RUNNING', to: 'SUCCESS' }

  ts              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mae_run         ON mimir_agent_events(conductor_run_id, id);
CREATE INDEX IF NOT EXISTS idx_mae_agent_run   ON mimir_agent_events(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_mae_type        ON mimir_agent_events(event_type);

-- Партиционирование по месяцу можно ввести позже, когда таблица разрастётся.
