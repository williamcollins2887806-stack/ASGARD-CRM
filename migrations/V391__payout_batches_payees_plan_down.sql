-- V391 down: откат планов выплат (список, второй получатель, «через кого»,
--           корректировка остатка, план ОВ).
-- Идемпотентно. Настройки, существовавшие до V391, не удаляются.

DROP TABLE IF EXISTS payout_plan_items;
DROP TABLE IF EXISTS payout_plans;
DROP TABLE IF EXISTS payout_batch_items;
DROP TABLE IF EXISTS payout_batches;

DROP INDEX IF EXISTS idx_wp_payee_employee;
ALTER TABLE worker_payments DROP COLUMN IF EXISTS payee_employee_id;

-- Возвращаем CHECK на type без carry_adjustment (значения этого типа надо
-- переклассифицировать заранее, иначе ALTER упадёт).
DO $$
BEGIN
  UPDATE worker_payments SET type = 'bonus'
   WHERE type = 'carry_adjustment' AND amount >= 0;
  UPDATE worker_payments SET type = 'penalty'
   WHERE type = 'carry_adjustment' AND amount < 0;
  ALTER TABLE worker_payments DROP CONSTRAINT IF EXISTS worker_payments_type_check;
  ALTER TABLE worker_payments
    ADD CONSTRAINT worker_payments_type_check
    CHECK (type::text = ANY (ARRAY[
      'per_diem'::text, 'salary'::text, 'advance'::text, 'bonus'::text, 'penalty'::text
    ]));
END $$;

DROP INDEX IF EXISTS idx_employees_se_payee2;
ALTER TABLE employees DROP COLUMN IF EXISTS se_payee_id_2;

DELETE FROM settings WHERE key = 'personnel_viewer_user_ids';
