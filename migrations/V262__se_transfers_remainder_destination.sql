-- V262 (spec: V258) — destination для остатка cash_return по СЗ-переводу.
-- Прим.: в спеке номер был V258, но V258 уже занят procurement_receipts,
-- поэтому миграция перенумерована в V262 (текущий хвост — V261).
--
-- Колонка remainder_destination определяет КУДА идёт cash_return_amount:
--   'pm'      — handover РП (worker_to_pm_handovers, влияет на pm_balance)
--   'company' — главная касса Асгарда (cash_balance_log income,
--               НЕ влияет на pm_balance)
--
-- Совместимость:
--   - DEFAULT 'pm' покрывает все существующие записи (поведение не меняется).
--   - bulk_batch_id опционален; нужен для трассировки группового создания.
--
-- pm-balance.js (НЕ ломаем):
--   se_legacy CTE фильтрует status IN ('completed','returned'). Bulk создаёт
--   se_transfers со status='transferred' → они НЕ попадают в se_legacy.
--   Handover для destination='pm' создаётся с source_se_transfer_id,
--   и LEFT JOIN h.id IS NULL в se_legacy исключает двойной учёт.

BEGIN;

ALTER TABLE se_transfers
  ADD COLUMN IF NOT EXISTS remainder_destination VARCHAR(20)
    NOT NULL DEFAULT 'pm';

-- Idempotency: если кто-то вручную создал колонку без default или с
-- невалидным значением — починим до добавления CHECK, иначе ADD CONSTRAINT
-- упадёт на «осиротевших» записях.
UPDATE se_transfers
   SET remainder_destination = 'pm'
 WHERE remainder_destination IS NULL
    OR remainder_destination NOT IN ('pm','company');

-- CHECK как DEFERRED idempotent: если уже есть — пропускаем.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_se_remainder_destination'
  ) THEN
    ALTER TABLE se_transfers
      ADD CONSTRAINT chk_se_remainder_destination
      CHECK (remainder_destination IN ('pm','company'));
  END IF;
END$$;

COMMENT ON COLUMN se_transfers.remainder_destination IS
  'Куда идёт cash_return_amount: pm = handover РП (+pm_balance), company = в главную кассу Асгарда (cash_balance_log income).';

-- Трейсинг bulk-операций
ALTER TABLE se_transfers
  ADD COLUMN IF NOT EXISTS bulk_batch_id UUID;

CREATE INDEX IF NOT EXISTS idx_se_transfers_bulk
  ON se_transfers(bulk_batch_id) WHERE bulk_batch_id IS NOT NULL;

COMMENT ON COLUMN se_transfers.bulk_batch_id IS
  'UUID группы для bulk-операций (POST /api/payroll-dashboard/se-transfers/bulk). NULL для single.';

COMMIT;
