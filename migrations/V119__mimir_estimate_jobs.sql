-- V119: persistent storage для просчётов Мимира
-- ──────────────────────────────────────────────────────────────────────────────
-- Раньше _aeJobs хранилось в памяти процесса Node.js (Map с TTL 10 мин).
-- Минусы: при рестарте сервера все идущие просчёты пропадали; готовые результаты
-- держались только 10 мин — потом юзер не мог открыть просчёт.
--
-- Теперь храним в БД:
--   - running/questions хранятся пока идут (с автопросрочкой по timeout)
--   - error держится 24 часа (для диагностики, потом авточистка)
--   - done хранится НАВСЕГДА — юзер может открыть просчёт через год и пересчитать

CREATE TABLE IF NOT EXISTS mimir_estimate_jobs (
  id              SERIAL PRIMARY KEY,
  job_key         TEXT NOT NULL,               -- 'w<work_id>' или 't<tender_id>'
  status          TEXT NOT NULL CHECK (status IN ('running','questions','done','error')),
  work_id         INTEGER REFERENCES works(id) ON DELETE SET NULL,
  tender_id       INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
  user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,

  -- Когда стартанул просчёт
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Когда закончился (done/error)
  completed_at    TIMESTAMPTZ,
  -- Когда последний раз обновляли (для определения "застрял ли")
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Содержимое
  session_id      TEXT,                        -- для фазы questions → answer
  questions       JSONB,                       -- массив вопросов
  result          JSONB,                       -- финальный результат (estimate_id + card)
  estimate_id     INTEGER,                     -- денормализация для быстрого индекса
  error_text      TEXT,
  error_code      TEXT,
  provider_message TEXT,

  -- Диагностика
  iterations      INTEGER DEFAULT 0,
  total_input_tokens INTEGER DEFAULT 0,
  total_output_tokens INTEGER DEFAULT 0
);

-- Один активный job на work/tender — но done может быть много (история)
CREATE INDEX IF NOT EXISTS idx_mimir_jobs_key_active
  ON mimir_estimate_jobs (job_key)
  WHERE status IN ('running','questions');

-- Быстрый поиск последнего job по тендеру/работе
CREATE INDEX IF NOT EXISTS idx_mimir_jobs_work ON mimir_estimate_jobs (work_id, started_at DESC) WHERE work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_mimir_jobs_tender ON mimir_estimate_jobs (tender_id, started_at DESC) WHERE tender_id IS NOT NULL;

-- Поиск активных просчётов юзера (для auto-recover при логине)
CREATE INDEX IF NOT EXISTS idx_mimir_jobs_user_active
  ON mimir_estimate_jobs (user_id, started_at DESC)
  WHERE status IN ('running','questions');

-- Поиск всех done для юзера/тендера/работы (отображение истории)
CREATE INDEX IF NOT EXISTS idx_mimir_jobs_done
  ON mimir_estimate_jobs (status, started_at DESC)
  WHERE status = 'done';

COMMENT ON TABLE mimir_estimate_jobs IS 'История просчётов Мимира. done хранится навсегда, error 24ч, running до завершения.';
