-- ═══════════════════════════════════════════════════════════════════════════
-- V243 DOWN: откат cash_requests/worker_payments изменений + drop handovers.
-- ═══════════════════════════════════════════════════════════════════════════
-- ВНИМАНИЕ: рудиментарный откат — данные в worker_to_pm_handovers будут
-- безвозвратно удалены. payment_method=NOT NULL остаётся (legacy NULL не
-- восстанавливаем — в любом случае была 'cash' до миграции UPDATE).
-- loan-→advance backfill необратим (не храним исходный type).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. worker_to_pm_handovers
DROP TABLE IF EXISTS worker_to_pm_handovers;

-- 2. cash_requests — снимаем V243-CHECK'и + новые колонки
ALTER TABLE cash_requests DROP CONSTRAINT IF EXISTS chk_cash_request_type_v243;
ALTER TABLE cash_requests DROP CONSTRAINT IF EXISTS chk_cash_request_category_v243;
ALTER TABLE cash_requests DROP CONSTRAINT IF EXISTS chk_cash_request_se_payee_v243;

DROP INDEX IF EXISTS idx_cash_requests_category;
DROP INDEX IF EXISTS idx_cash_requests_se_payee;

ALTER TABLE cash_requests
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS category_other_desc,
  DROP COLUMN IF EXISTS use_se_payee,
  DROP COLUMN IF EXISTS se_payee_employee_id,
  DROP COLUMN IF EXISTS se_transfer_id;

-- 3. worker_payments
ALTER TABLE worker_payments DROP CONSTRAINT IF EXISTS chk_wp_paid_by_role_v243;
DROP INDEX IF EXISTS idx_wp_paid_by_role;
ALTER TABLE worker_payments DROP COLUMN IF EXISTS paid_by_role;
-- payment_method DEFAULT/NOT NULL оставляем — это безопасный инвариант.

COMMIT;
