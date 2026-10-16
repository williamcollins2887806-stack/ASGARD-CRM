-- ============================================================================
-- V396: Пересчёт is_incomplete / incomplete_reasons на существующих строках.
-- ----------------------------------------------------------------------------
-- Причина: D-238 снял правило «нет срока оплаты → неполнота», но колонки
-- is_incomplete/incomplete_reasons не пересчитались — 1510 строк хранят
-- устаревшую причину no_payment_due. С новым светофором это даёт ложный СИНИЙ
-- на ~2/3 реестра и скрывает реальные жёлтый/красный.
--
-- Приводим к ТОЧНОМУ зеркалу calcIncomplete() (src/routes/doc-registry.js):
--   no_invoice_number — пустой invoice_number
--   no_invoice_date   — пустая invoice_date
--   no_counterparty   — пустой counterparty_name
--   no_contract       — contract_mode='linked' и нет contract_id
--   no_work           — dir='in', spend_kind='work', нет work_id и не «АСГАРД»/«расходники»
-- Идемпотентно. Down — V396__..._down.sql (восстановление не требуется).
-- ============================================================================

UPDATE doc_registry d
SET incomplete_reasons = sub.reasons,
    is_incomplete = (array_length(sub.reasons, 1) IS NOT NULL),
    updated_at = NOW()
FROM (
  SELECT id,
    ARRAY(
      SELECT r FROM (VALUES
        (1, 'no_invoice_number', NULLIF(TRIM(COALESCE(invoice_number, '')), '') IS NULL),
        (2, 'no_invoice_date',   invoice_date IS NULL),
        (3, 'no_counterparty',   NULLIF(TRIM(COALESCE(counterparty_name, '')), '') IS NULL),
        (4, 'no_contract',       COALESCE(contract_mode, 'none') = 'linked' AND contract_id IS NULL),
        (5, 'no_work',           dir = 'in' AND COALESCE(spend_kind, 'work') = 'work'
                                  AND work_id IS NULL AND purpose_asgard IS NOT TRUE
                                  AND purpose_consumables IS NOT TRUE)
      ) v(ord, r, hit)
      WHERE hit ORDER BY ord
    ) AS reasons
  FROM doc_registry
  WHERE deleted_at IS NULL
) sub
WHERE d.id = sub.id
  AND (d.is_incomplete IS DISTINCT FROM (array_length(sub.reasons, 1) IS NOT NULL)
       OR d.incomplete_reasons IS DISTINCT FROM sub.reasons);

COMMENT ON COLUMN doc_registry.is_incomplete IS
  'V396: пересчитано под актуальный calcIncomplete (без no_payment_due, D-238). '
  'Источник истины — src/routes/doc-registry.js calcIncomplete().';
