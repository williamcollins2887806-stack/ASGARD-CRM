-- ═══════════════════════════════════════════════════════════
-- V047: Мимир AI-анализ подсказок — кеш-таблица
-- cache_key: 'ADMIN:tenders', 'PM_42:employee_271', 'BUH:invoices'
-- Кеш на 24 часа, хеш подсказок для инвалидации
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mimir_hint_analysis_cache (
    id              SERIAL PRIMARY KEY,
    cache_key       VARCHAR(200) NOT NULL,
    role            VARCHAR(50) NOT NULL,
    page            VARCHAR(100) NOT NULL,
    user_id         INTEGER,
    hints_hash      VARCHAR(16) NOT NULL,
    analysis_text   TEXT NOT NULL,
    hints_snapshot  JSONB,
    tokens_input    INTEGER DEFAULT 0,
    tokens_output   INTEGER DEFAULT 0,
    model_used      VARCHAR(100),
    duration_ms     INTEGER DEFAULT 0,
    generated_at    TIMESTAMP DEFAULT NOW(),
    expires_at      TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours')
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_hint_analysis_key
  ON mimir_hint_analysis_cache (cache_key);

CREATE INDEX IF NOT EXISTS idx_hint_analysis_expires
  ON mimir_hint_analysis_cache (expires_at);
