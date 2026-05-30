-- ═══════════════════════════════════════════════════════════════════════════
-- Mimir Conductor Refactor — Сессия 1, Шаг 1.1
-- V133: главная таблица запусков просчёта (Conductor runs)
-- Каждый клик «Просчитать» = новая запись.
--
-- ПРИМЕЧАНИЕ ПО НУМЕРАЦИИ: в плане эта миграция называлась V131, но на ветке
-- mobile-v3 номера V131/V132 уже заняты (max_chat_integration, tkp_quick_banner).
-- Поэтому весь блок Conductor сдвинут на V133..V139 (см. CONDUCTOR_PROMPT_ADDENDUM.md).
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mimir_conductor_runs (
  id              BIGSERIAL PRIMARY KEY,
  work_id         BIGINT REFERENCES works(id) ON DELETE CASCADE,
  tender_id       BIGINT REFERENCES tenders(id) ON DELETE CASCADE,
  estimate_id     BIGINT REFERENCES estimates(id) ON DELETE SET NULL,
  initiated_by    BIGINT REFERENCES users(id),

  -- Состояние
  status          TEXT NOT NULL DEFAULT 'DRAFT',
    -- DRAFT, RUNNING, BLOCKED_BY_PM, BLOCKED_BY_CUSTOMER,
    -- CONSOLIDATING, READY_FOR_REVIEW, APPROVED, REJECTED, CANCELLED, ERROR
  blocked_reason  TEXT,
  blocked_since   TIMESTAMPTZ,

  -- Профиль и сложность
  profile         TEXT NOT NULL DEFAULT 'STANDARD',
    -- LIGHT, STANDARD, HEAVY, CUSTOM
  contract_value  NUMERIC(14,2),
  complexity_flags JSONB NOT NULL DEFAULT '{}',
    -- { has_OZP: true, has_welding: false, distance_km: 1200, ... }

  -- Conductor
  conductor_model TEXT,                  -- claude-opus-4-7 или claude-sonnet-4-6
  conductor_run_id BIGINT,               -- ссылка на mimir_agent_runs основного цикла

  -- Финал
  final_artifact_hash TEXT,
  final_estimate_data JSONB,             -- последний снимок сметы

  -- Метрики
  total_cost_rub      NUMERIC(10,2) DEFAULT 0,
  total_input_tokens  BIGINT DEFAULT 0,
  total_output_tokens BIGINT DEFAULT 0,
  total_duration_ms   BIGINT DEFAULT 0,

  -- Timestamps
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcr_status        ON mimir_conductor_runs(status);
CREATE INDEX IF NOT EXISTS idx_mcr_work          ON mimir_conductor_runs(work_id) WHERE work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcr_tender        ON mimir_conductor_runs(tender_id) WHERE tender_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mcr_initiated_by  ON mimir_conductor_runs(initiated_by);
CREATE INDEX IF NOT EXISTS idx_mcr_blocked       ON mimir_conductor_runs(status) WHERE status LIKE 'BLOCKED_%';
