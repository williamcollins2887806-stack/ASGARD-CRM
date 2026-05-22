-- V117: поля для нового флоу Выиграли/Проиграли/Отменён + назначение РП на работы
-- ──────────────────────────────────────────────────────────────────────────────
-- Эти поля нужны новым endpoint'ам:
--   POST /api/tenders/:id/win              → won_at, won_by_user_id
--   POST /api/tenders/:id/lose             → lost_at, lost_by_user_id, lose_cover_letter, winner_name
--   POST /api/tenders/:id/cancel           → archived_at/archived_by_user_id уже есть
--   POST /api/tenders/:id/assign-work-pm   → work_assigned_pm_id, work_assigned_at, work_assigned_by_user_id

ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS won_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS won_by_user_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS lost_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lost_by_user_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS lose_cover_letter TEXT,
  ADD COLUMN IF NOT EXISTS winner_name TEXT,
  ADD COLUMN IF NOT EXISTS work_assigned_pm_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS work_assigned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS work_assigned_by_user_id INTEGER REFERENCES users(id);

-- Индекс для win-pending выборки (Выиграли без работы)
CREATE INDEX IF NOT EXISTS idx_tenders_win_pending
  ON tenders (tender_status, won_at DESC)
  WHERE tender_status = 'Выиграли' AND work_assigned_pm_id IS NULL;

COMMENT ON COLUMN tenders.work_assigned_pm_id IS 'РП назначенный HEAD_TO для ВЫПОЛНЕНИЯ работ (может отличаться от responsible_pm_id — кто считал)';
COMMENT ON COLUMN tenders.lose_cover_letter IS 'Сопроводительное письмо при проигрыше — анализ для команды';
