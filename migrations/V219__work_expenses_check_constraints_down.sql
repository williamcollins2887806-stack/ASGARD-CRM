-- V219 down: убрать CHECK-constraints + NOT NULL/DEFAULT с payment_method
-- Категории и данные НЕ откатываем (cleanup был необратимый: 'food'→'cash'/sub='food').
ALTER TABLE work_expenses DROP CONSTRAINT IF EXISTS chk_work_expenses_subcategory;
ALTER TABLE work_expenses DROP CONSTRAINT IF EXISTS chk_work_expenses_payment_method;
ALTER TABLE work_expenses DROP CONSTRAINT IF EXISTS chk_work_expenses_category;
ALTER TABLE work_expenses ALTER COLUMN payment_method DROP NOT NULL;
ALTER TABLE work_expenses ALTER COLUMN payment_method DROP DEFAULT;
