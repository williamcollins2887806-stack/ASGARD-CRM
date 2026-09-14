-- down V326: revert category columns and restore conservative template flags.
-- Note: seeded catalog rows are kept (soft data); schema_json blocks remain —
-- re-apply V325 baseline schema_json manually if a hard revert of forms is needed.

UPDATE nd_form_templates SET template_ready = false, updated_at = NOW()
WHERE code IN ('height', 'electrical_903n');

ALTER TABLE nd_risk_catalog DROP COLUMN IF EXISTS category;
ALTER TABLE nd_measure_catalog DROP COLUMN IF EXISTS category;

DROP INDEX IF EXISTS idx_nd_risk_category;
DROP INDEX IF EXISTS idx_nd_measure_category;
DROP INDEX IF EXISTS idx_nd_risk_form_codes;
