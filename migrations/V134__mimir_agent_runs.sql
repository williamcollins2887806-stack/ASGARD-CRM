-- ═══════════════════════════════════════════════════════════════════════════
-- Mimir Conductor Refactor — Сессия 1, Шаг 1.1
-- V134 (план: V132): пробег каждого агента в рамках одного просчёта.
-- Включая сам Conductor (он тоже агент).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mimir_agent_runs (
  id              BIGSERIAL PRIMARY KEY,
  conductor_run_id BIGINT NOT NULL REFERENCES mimir_conductor_runs(id) ON DELETE CASCADE,

  agent_name      TEXT NOT NULL,         -- 'conductor', 'tz_analyst', 'resource_planner', ...
  agent_version   TEXT NOT NULL DEFAULT 'v1',
  parent_agent_run_id BIGINT REFERENCES mimir_agent_runs(id), -- кто вызвал

  model           TEXT NOT NULL,         -- claude-opus-4-7, claude-sonnet-4-6, sonar-opus-online, ...
  prompt_hash     TEXT NOT NULL,         -- хеш системного промпта (для воспроизводимости)

  -- Вход
  input_artifact_hashes JSONB DEFAULT '[]', -- какие артефакты получил на вход
  input_extra     JSONB,                    -- дополнительный контекст (focus_areas, options)

  -- Выход
  output_artifact_id BIGINT,             -- ссылка на mimir_artifacts (если артефакт создан)
  output_summary  TEXT,                  -- 1-2 предложения для UI

  -- Статус
  status          TEXT NOT NULL DEFAULT 'PENDING',
    -- PENDING, RUNNING, SUCCESS, ERROR, CANCELLED, BLOCKED_ON_CLARIFICATION
  error_text      TEXT,
  error_code      TEXT,

  -- Метрики
  input_tokens    INT DEFAULT 0,
  output_tokens   INT DEFAULT 0,
  cache_read_tokens INT DEFAULT 0,
  cache_write_tokens INT DEFAULT 0,
  cost_rub        NUMERIC(8,4) DEFAULT 0,
  duration_ms     INT DEFAULT 0,
  iterations      INT DEFAULT 0,         -- для agent loops

  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mar_conductor    ON mimir_agent_runs(conductor_run_id);
CREATE INDEX IF NOT EXISTS idx_mar_status       ON mimir_agent_runs(conductor_run_id, status);
CREATE INDEX IF NOT EXISTS idx_mar_agent_name   ON mimir_agent_runs(agent_name);
