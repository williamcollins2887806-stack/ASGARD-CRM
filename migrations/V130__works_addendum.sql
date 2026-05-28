-- V130: works — доп.соглашение к тендеру как отдельная работа
-- ДС = новая works под тем же tender_id с work_kind='addendum' и parent_work_id основной работы.
-- Отдельная сумма (contract_value), отдельные акты/счета/просчёты (они уже привязаны к work_id).

ALTER TABLE works ADD COLUMN IF NOT EXISTS work_kind VARCHAR(32) NOT NULL DEFAULT 'main';
-- 'main' | 'addendum'
ALTER TABLE works ADD COLUMN IF NOT EXISTS parent_work_id INTEGER REFERENCES works(id) ON DELETE SET NULL;
ALTER TABLE works ADD COLUMN IF NOT EXISTS addendum_number VARCHAR(50);
-- 'ДС-1', 'ДС-2' … — нумерация в пределах parent_work_id
ALTER TABLE works ADD COLUMN IF NOT EXISTS addendum_signed_date DATE;
ALTER TABLE works ADD COLUMN IF NOT EXISTS addendum_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_works_addendum_consistency') THEN
    ALTER TABLE works ADD CONSTRAINT chk_works_addendum_consistency CHECK (
      (work_kind = 'addendum' AND parent_work_id IS NOT NULL) OR
      (work_kind = 'main')
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_works_parent ON works(parent_work_id) WHERE parent_work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_works_kind   ON works(work_kind);

COMMENT ON COLUMN works.work_kind IS 'main = основная работа по тендеру, addendum = доп.соглашение (отдельная сумма, отдельные акты/счета)';
COMMENT ON COLUMN works.parent_work_id IS 'NULL для main; id основной работы для addendum';
