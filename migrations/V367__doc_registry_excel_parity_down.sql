-- down V367
ALTER TABLE doc_registry DROP CONSTRAINT IF EXISTS doc_registry_spend_kind_check;
ALTER TABLE doc_registry
  DROP COLUMN IF EXISTS contract_date,
  DROP COLUMN IF EXISTS contract_has_scan,
  DROP COLUMN IF EXISTS contract_has_original,
  DROP COLUMN IF EXISTS vitya_state,
  DROP COLUMN IF EXISTS spend_kind;
