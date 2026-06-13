-- V206: «Кто считает тендер» — РП или сам ТО.
-- Контекст: ~70% тендеров мелкие и ТО может посчитать сам. Согласует HEAD_TO
-- (вместо директора). См. также:
--   src/routes/approval.js       — снят блок «TO/HEAD_TO» для kind='to'
--   src/services/approvalService.js — HEAD_TO стал согласующим для kind='to'
--   src/routes/tkp.js            — TO/HEAD_TO допущены к POST /tkp по своим тендерам
-- Безопасно: только ADD COLUMN + CHECK + индекс. На существующие записи NULL
-- (поведение старое: считает РП). Старый флоу не ломается.

ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS calculator_kind    VARCHAR(10),
  ADD COLUMN IF NOT EXISTS calculator_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- CHECK: либо NULL (не выбрано / старые), либо 'pm' / 'to'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenders_calculator_kind_check'
  ) THEN
    ALTER TABLE tenders
      ADD CONSTRAINT tenders_calculator_kind_check
      CHECK (calculator_kind IS NULL OR calculator_kind IN ('pm','to'));
  END IF;
END $$;

-- Partial-индекс — очередь «считает ТО» обычно маленькая, ходим часто
CREATE INDEX IF NOT EXISTS idx_tenders_calc_kind_to
  ON tenders (calculator_user_id)
  WHERE calculator_kind = 'to';

COMMENT ON COLUMN tenders.calculator_kind IS
  'Кто считает тендер: pm = РП (как раньше), to = сам ТО (мелкие). NULL = ещё не выбрано.';
COMMENT ON COLUMN tenders.calculator_user_id IS
  'ID расчётчика. При kind=pm обычно совпадает с responsible_pm_id; при kind=to — конкретный ТО.';
