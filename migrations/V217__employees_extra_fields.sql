-- V217: Доп. поля анкеты сотрудника (15 колонок).
-- Контекст: vanilla employee.js блоки «Экстренные контакты» (стр. 269–294)
-- и «Дополнительно» (стр. 296–337). В React v2 — EmployeeExtraFields.jsx.
-- Backend EMPLOYEE_COLS allowlist (staff.js:8) расширен теми же полями.
-- Без миграции PUT /api/staff/employees/:id молча фильтрует эти поля.

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS phone2             VARCHAR(50),
  ADD COLUMN IF NOT EXISTS telegram           VARCHAR(100),
  ADD COLUMN IF NOT EXISTS spouse_name        VARCHAR(255),
  ADD COLUMN IF NOT EXISTS spouse_phone       VARCHAR(50),
  ADD COLUMN IF NOT EXISTS relative_name      VARCHAR(255),
  ADD COLUMN IF NOT EXISTS relative_relation  VARCHAR(100),
  ADD COLUMN IF NOT EXISTS relative_phone     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS education          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS specialty          VARCHAR(255),
  ADD COLUMN IF NOT EXISTS marital_status     VARCHAR(50),
  ADD COLUMN IF NOT EXISTS children_count     INTEGER,
  ADD COLUMN IF NOT EXISTS shoe_size          VARCHAR(20),
  ADD COLUMN IF NOT EXISTS height             INTEGER,
  ADD COLUMN IF NOT EXISTS blood_type         VARCHAR(10),
  ADD COLUMN IF NOT EXISTS medical_notes      TEXT;
