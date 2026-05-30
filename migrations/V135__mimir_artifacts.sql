-- ═══════════════════════════════════════════════════════════════════════════
-- Mimir Conductor Refactor — Сессия 1, Шаг 1.1
-- V135 (план: V133): артефакты — типизированные JSON-объекты, которыми
-- обмениваются агенты. Контент-аддресуемые через sha256-хеш content.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mimir_artifacts (
  id              BIGSERIAL PRIMARY KEY,
  conductor_run_id BIGINT NOT NULL REFERENCES mimir_conductor_runs(id) ON DELETE CASCADE,
  created_by_agent_run_id BIGINT REFERENCES mimir_agent_runs(id),

  artifact_type   TEXT NOT NULL,
    -- 'tz_summary', 'resources', 'market_offers', 'procurement', 'crew_plan',
    -- 'labor_cost', 'routing_plan', 'travel_cost', 'transport_cost',
    -- 'permits_plan', 'site_conditions', 'method_validation', 'warehouse_match',
    -- 'risk_analysis', 'analogs_comparison', 'final_estimate', 'devils_advocate', ...

  content         JSONB NOT NULL,
  content_hash    TEXT NOT NULL,         -- sha256 от content для дедупликации
  schema_version  TEXT NOT NULL DEFAULT 'v1',

  superseded_by   BIGINT REFERENCES mimir_artifacts(id),  -- при пересчёте старый помечается

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mart_run        ON mimir_artifacts(conductor_run_id);
CREATE INDEX IF NOT EXISTS idx_mart_type       ON mimir_artifacts(conductor_run_id, artifact_type) WHERE superseded_by IS NULL;
CREATE INDEX IF NOT EXISTS idx_mart_hash       ON mimir_artifacts(content_hash);
