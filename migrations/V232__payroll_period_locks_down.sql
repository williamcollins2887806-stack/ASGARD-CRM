-- V232 DOWN: дроп таблицы локов периода (включая оба индекса каскадно).
DROP INDEX IF EXISTS idx_period_locks_lookup;
DROP INDEX IF EXISTS uniq_payroll_period_active_lock;
DROP TABLE IF EXISTS payroll_period_locks;
