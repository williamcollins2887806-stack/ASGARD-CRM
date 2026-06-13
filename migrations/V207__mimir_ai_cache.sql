-- V207: AI-кэш для детерминированных Conductor-просчётов (5/5 reproducibility).
-- Идея: один и тот же system+messages для одной и той же модели → одинаковый ответ.
-- При повторном просчёте того же тендера Conductor читает кэш вместо повторного вызова AI,
-- что гарантирует абсолютную идентичность всех ранов (с точностью до выбора кэша).
--
-- Ключ: sha256(system + JSON.stringify(messages) + model + temperature)
-- Срок жизни: бессрочно, но с UPDATE updated_at и счётчиком хитов для аналитики.
--
-- Безопасность: НЕ кэшируем чаты пользователей и mail-replies — только Conductor-агенты
-- (через aiCompleteJson и completeWithStream в режиме Conductor).

CREATE TABLE IF NOT EXISTS mimir_ai_cache (
  input_hash      TEXT PRIMARY KEY,
  model           TEXT NOT NULL,
  agent_name      TEXT,
  output_text     TEXT NOT NULL,
  output_usage    JSONB,
  hit_count       INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mimir_ai_cache_agent_created
  ON mimir_ai_cache (agent_name, created_at DESC);
