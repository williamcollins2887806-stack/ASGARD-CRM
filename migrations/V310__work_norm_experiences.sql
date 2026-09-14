-- V310: банк опыта РП (факты с объектов) → публикация в нормы
-- + расширяем change_log для experience/publish/confirm

ALTER TABLE work_norm_change_log DROP CONSTRAINT IF EXISTS work_norm_change_log_action_check;
ALTER TABLE work_norm_change_log
  ADD CONSTRAINT work_norm_change_log_action_check
  CHECK (action IN ('create','update','delete','import','confirm','publish','reject'));

CREATE TABLE IF NOT EXISTS work_norm_experiences (
  id                BIGSERIAL PRIMARY KEY,
  category_code     TEXT NOT NULL REFERENCES work_norm_categories(code),
  method_code       TEXT,
  object_label      TEXT,
  qty               NUMERIC,
  volume_value      NUMERIC,
  volume_unit       TEXT,
  diameter_mm       NUMERIC,
  length_m          NUMERIC,
  fouling           TEXT CHECK (fouling IS NULL OR fouling IN ('light','medium','heavy')),
  fouling_note      TEXT,
  calendar_days     NUMERIC,
  shift_mode        INT NOT NULL DEFAULT 2 CHECK (shift_mode IN (1, 2)),
  crew_masters      INT,
  crew_exec         INT,
  crew_other_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
  equipment_text    TEXT,
  source_work_id    INT,
  source_tender_id  INT,
  customer_name     TEXT,
  object_name       TEXT,
  period_text       TEXT,
  story_text        TEXT NOT NULL,
  derived_metric    TEXT,
  derived_value     NUMERIC,
  derived_unit      TEXT,
  derived_trace     TEXT,
  status            TEXT NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','confirmed','published','rejected')),
  published_rate_id BIGINT REFERENCES work_norm_rates(id),
  comment           TEXT,
  created_by        INT REFERENCES users(id),
  confirmed_by      INT REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at      TIMESTAMPTZ,
  published_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_work_norm_exp_cat_status
  ON work_norm_experiences(category_code, status);
CREATE INDEX IF NOT EXISTS idx_work_norm_exp_diameter
  ON work_norm_experiences(diameter_mm, fouling)
  WHERE diameter_mm IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_work_norm_exp_created
  ON work_norm_experiences(created_at DESC);
