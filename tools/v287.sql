CREATE UNIQUE INDEX IF NOT EXISTS idx_works_one_main_per_tender
  ON works(tender_id)
  WHERE deleted_at IS NULL AND COALESCE(work_kind, 'main') = 'main';
