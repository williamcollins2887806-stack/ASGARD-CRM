-- V287: одна основная работа на тендер (защита от дублей create-work)
CREATE UNIQUE INDEX IF NOT EXISTS idx_works_one_main_per_tender
  ON works(tender_id)
  WHERE deleted_at IS NULL AND COALESCE(work_kind, 'main') = 'main';

COMMENT ON INDEX idx_works_one_main_per_tender IS 'Не более одной main-работы на тендер; addendum (ДС) разрешены отдельно';
