-- V367: Doc Hub Excel parity fields (после V354)
-- contract date/flags, блок «Для Вити», spend_kind (работа/склад/офис/прочее)

ALTER TABLE doc_registry
  ADD COLUMN IF NOT EXISTS contract_date DATE,
  ADD COLUMN IF NOT EXISTS contract_has_scan BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS contract_has_original BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vitya_state TEXT,
  ADD COLUMN IF NOT EXISTS spend_kind VARCHAR(16) NOT NULL DEFAULT 'work';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'doc_registry_spend_kind_check'
  ) THEN
    ALTER TABLE doc_registry
      ADD CONSTRAINT doc_registry_spend_kind_check
      CHECK (spend_kind IN ('work', 'warehouse', 'office', 'other'));
  END IF;
END $$;

COMMENT ON COLUMN doc_registry.contract_date IS 'Дата договора (Excel); при linked может зеркалить реестр договоров';
COMMENT ON COLUMN doc_registry.contract_has_scan IS 'Есть скан договора';
COMMENT ON COLUMN doc_registry.contract_has_original IS 'Есть оригинал договора';
COMMENT ON COLUMN doc_registry.vitya_state IS 'Для Вити — Состояние';
COMMENT ON COLUMN doc_registry.spend_kind IS 'work|warehouse|office|other — тип расхода / привязки к объекту';
