-- V380: Дашборд разработки CRM (roadmap директора развития)
-- Структура этапов/пунктов/чекпоинтов + аудит-лог подписей закрытия.
-- Идемпотентно: IF NOT EXISTS. Сиды структуры грузит tools/dev-roadmap-seed.js.
--
-- Терминология:
--   stage      — этап (Финансы, Рабочие, График офиса, Биометрия, Планшеты, Коммуникации, Агенты)
--   item       — пункт внутри этапа (задача из заметок директора)
--   checkpoint — шаг жизненного цикла пункта (анализ → макет → утверждение → разработка → тесты → запуск)
--   event      — аудит-лог: кто и когда закрыл/переоткрыл чекпоинт (доказательство подписи)

CREATE TABLE IF NOT EXISTS dev_roadmap_stages (
  id          SERIAL PRIMARY KEY,
  code        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  short_title TEXT,
  color       TEXT NOT NULL DEFAULT 'blue',
  start_date  DATE,
  deadline    DATE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dev_roadmap_items (
  id          SERIAL PRIMARY KEY,
  stage_id    INTEGER NOT NULL REFERENCES dev_roadmap_stages(id) ON DELETE CASCADE,
  code        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT,
  owner_id    TEXT,
  start_date  DATE,
  deadline    DATE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dev_roadmap_items_stage ON dev_roadmap_items (stage_id, sort_order);

CREATE TABLE IF NOT EXISTS dev_roadmap_checkpoints (
  id          SERIAL PRIMARY KEY,
  item_id     INTEGER NOT NULL REFERENCES dev_roadmap_items(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'dev'
              CHECK (kind IN ('analysis','design','approval','dev','test','demo','launch')),
  title       TEXT NOT NULL,
  owner_id    TEXT,
  deadline    DATE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  done        BOOLEAN NOT NULL DEFAULT false,
  done_at     TIMESTAMPTZ,
  done_by     TEXT,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, code)
);
CREATE INDEX IF NOT EXISTS idx_dev_roadmap_cp_item ON dev_roadmap_checkpoints (item_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_dev_roadmap_cp_done ON dev_roadmap_checkpoints (done);

-- Аудит-лог подписей: КАЖДОЕ закрытие/переоткрытие. Это доказательство «кто закрыл».
CREATE TABLE IF NOT EXISTS dev_roadmap_events (
  id            BIGSERIAL PRIMARY KEY,
  checkpoint_id INTEGER REFERENCES dev_roadmap_checkpoints(id) ON DELETE SET NULL,
  item_code     TEXT NOT NULL,
  cp_code       TEXT NOT NULL,
  action        TEXT NOT NULL CHECK (action IN ('close','reopen')),
  signer_id     TEXT NOT NULL,
  signer_name   TEXT NOT NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dev_roadmap_events_cp ON dev_roadmap_events (checkpoint_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_dev_roadmap_events_created ON dev_roadmap_events (created_at DESC);
