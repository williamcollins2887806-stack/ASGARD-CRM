-- V182: Принудительное закрытие этапов готовности проекта руководителем проекта.
-- Агрегат готовности (work-readiness) считается из данных модулей подготовки.
-- Если этап реально закрыт мимо системы (напр. билеты купили вручную), РП может
-- принудительно пометить этап «готов» — эта таблица хранит такие override-метки.

CREATE TABLE IF NOT EXISTS project_readiness_overrides (
  id          SERIAL       PRIMARY KEY,
  work_id     INTEGER      NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  stage       VARCHAR(20)  NOT NULL CHECK (stage IN (
                'personnel','training','procurement','assembly','tickets','housing','logistics'
              )),
  forced_done BOOLEAN      NOT NULL DEFAULT TRUE,
  note        TEXT,
  created_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (work_id, stage)
);

CREATE INDEX IF NOT EXISTS idx_pro_work ON project_readiness_overrides(work_id);
