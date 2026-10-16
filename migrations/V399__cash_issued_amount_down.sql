-- V399 down: убрать факт-сумму выдачи.
ALTER TABLE cash_requests DROP COLUMN IF EXISTS issued_amount;
