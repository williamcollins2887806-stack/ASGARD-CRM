-- V239 DOWN: дроп колонок стартовой корректировки СЗ-лимита.
ALTER TABLE employees DROP COLUMN IF EXISTS se_yearly_used_initial;
ALTER TABLE employees DROP COLUMN IF EXISTS se_monthly_used_initial;
