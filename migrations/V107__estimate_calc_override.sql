-- V107: estimate_calculation_data — поля для ручного редактирования отчёта Мимира

ALTER TABLE estimate_calculation_data
  ADD COLUMN IF NOT EXISTS calc_override_json  JSONB,
  ADD COLUMN IF NOT EXISTS override_by         INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS override_at         TIMESTAMP,
  ADD COLUMN IF NOT EXISTS has_override        BOOLEAN DEFAULT FALSE;

-- Для доступа Мимира к отредактированному отчёту
CREATE INDEX IF NOT EXISTS idx_ecd_has_override ON estimate_calculation_data(estimate_id) WHERE has_override = TRUE;
