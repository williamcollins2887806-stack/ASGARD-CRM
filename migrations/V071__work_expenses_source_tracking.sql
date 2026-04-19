-- V071: work_expenses source tracking for auto-sync from other tables
-- work_expenses becomes the Single Source of Truth for all financial expenses.
-- Автосинк: field_checkins (после закрытия табеля) → fot category
--           worker_payments (сразу)                → per_diem/fot/advance
--           field_master_expenses (сразу)          → по category из полевого модуля
--           manual (через UI)                      → любая category
-- is_finalized=TRUE — при закрытии работы запись фиксируется,
--                     триггеры перестают её менять.

ALTER TABLE work_expenses
  ADD COLUMN IF NOT EXISTS source_table VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_id INTEGER,
  ADD COLUMN IF NOT EXISTS source_key VARCHAR(100),  -- composite key для агрегаций (work_id:employee_id)
  ADD COLUMN IF NOT EXISTS is_finalized BOOLEAN DEFAULT FALSE;

-- Уникальный индекс по (source_table, source_key) для дедупликации автосинка.
-- source_key используется когда один логический расход агрегируется из множества записей
-- (например ФОТ = сумма всех смен одного сотрудника на одной работе).
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_expenses_source_key
  ON work_expenses (source_table, source_key)
  WHERE source_table IS NOT NULL AND source_key IS NOT NULL;

-- Быстрый поиск по source_id
CREATE INDEX IF NOT EXISTS idx_work_expenses_source_id
  ON work_expenses (source_table, source_id)
  WHERE source_table IS NOT NULL AND source_id IS NOT NULL;

-- Быстрый поиск "все авто-расходы этой работы"
CREATE INDEX IF NOT EXISTS idx_work_expenses_work_source
  ON work_expenses (work_id, source_table);

COMMENT ON COLUMN work_expenses.source_table IS 'Имя таблицы-источника: field_checkins, worker_payments, field_master_expenses, manual';
COMMENT ON COLUMN work_expenses.source_id IS 'ID записи в таблице-источнике (для 1:1 синхронизации)';
COMMENT ON COLUMN work_expenses.source_key IS 'Composite ключ для агрегированных расходов (work_id:employee_id для ФОТ)';
COMMENT ON COLUMN work_expenses.is_finalized IS 'Расход зафиксирован (работа закрыта), триггеры автосинка его не меняют';
