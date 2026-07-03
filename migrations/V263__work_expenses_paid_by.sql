-- V263: work_expenses.paid_by — кто фактически выдал/перевёл деньги.
-- Цель: различать «РП лично платил из своей кассы» (списать с pm-balance)
-- от «компания платила корп.картой/безналом» (НЕ списывать с pm-balance,
-- хотя 55% налог всё равно начисляется на cash/card/self).
--
-- Источник правды для формулы баланса РП: src/lib/pm-balance.js (work_exp_direct CTE).

BEGIN;

ALTER TABLE work_expenses
  ADD COLUMN IF NOT EXISTS paid_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS paid_by_role VARCHAR(20);

CREATE INDEX IF NOT EXISTS idx_work_expenses_paid_by
  ON work_expenses(paid_by) WHERE paid_by IS NOT NULL;

COMMENT ON COLUMN work_expenses.paid_by IS
  'Кто фактически выдал деньги (FK users). NULL = не определено. Используется в pm-balance.js для решения списать ли расход с баланса РП.';
COMMENT ON COLUMN work_expenses.paid_by_role IS
  'pm | director | buh | admin | field_master — роль исполнителя выплаты на момент создания записи.';

-- Backfill: исторические работающие записи cash/card на работах с pm_id
-- из источника manual / manual_journal_import — это записи где РП сам вносил.
-- Записи синхронизированные из worker_payments уже имеют paid_by через wp.paid_by,
-- их не трогаем (формула учитывает через JOIN worker_payments).
UPDATE work_expenses we
   SET paid_by = w.pm_id,
       paid_by_role = 'pm'
  FROM works w
 WHERE we.work_id = w.id
   AND w.pm_id IS NOT NULL
   AND we.payment_method IN ('cash', 'card')
   AND COALESCE(we.source_table, '') IN ('manual', 'manual_journal_import')
   AND we.paid_by IS NULL;

COMMIT;
