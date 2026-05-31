-- ============================================================================
-- ASGARD CRM — Mimir Conductor: RAG-индекс нормативов (Сессия 6, Шаг 6.0)
-- ============================================================================
-- Таблица для семантического поиска по нормативам ГЭСН/ФЕР/СТО.
-- Используется агентом resource_planner для привязки работ к расценкам.
--
-- Embeddings считаются через ai-provider.embed() (routerai → voyage-3-large,
-- размерность 1024). В stub-режиме — детерминированный псевдо-вектор.
--
-- pgvector: на dev и проде расширение vector установлено (проверено).
-- Если его нет — миграция мягко создаст расширение (CREATE EXTENSION IF NOT EXISTS).
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS mimir_norms_index (
  id          BIGSERIAL PRIMARY KEY,
  source      TEXT NOT NULL,            -- 'GESN' | 'FER' | 'STO_GAZPROM' | 'STO_TRANSNEFT' | ...
  code        TEXT NOT NULL,            -- шифр расценки, напр. 'ГЭСНм 38-04-001'
  name        TEXT NOT NULL,            -- наименование работы
  unit        TEXT,                     -- единица измерения
  full_text   TEXT NOT NULL,            -- полный текст расценки (для контекста LLM)
  resources   JSONB DEFAULT '{}'::jsonb,-- раскладка ресурсов (материалы/труд/маш-часы)
  rate_per_unit NUMERIC,                -- базовая расценка на единицу (если есть)
  embedding   vector(1024),            -- семантический вектор (voyage-3-large)
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT mimir_norms_source_code_uniq UNIQUE (source, code)
);

-- Индекс для текстового поиска по шифру/наименованию (быстрый prefilter).
CREATE INDEX IF NOT EXISTS idx_mimir_norms_source ON mimir_norms_index (source);
CREATE INDEX IF NOT EXISTS idx_mimir_norms_code   ON mimir_norms_index (code);

-- HNSW-индекс для approximate nearest neighbor по косинусной близости.
-- Создаётся только если расширение vector доступно (оно уже выше CREATE EXTENSION).
CREATE INDEX IF NOT EXISTS idx_mimir_norms_embed
  ON mimir_norms_index USING hnsw (embedding vector_cosine_ops);

COMMENT ON TABLE mimir_norms_index IS 'RAG-индекс нормативов ГЭСН/ФЕР/СТО для resource_planner (Сессия 6)';
