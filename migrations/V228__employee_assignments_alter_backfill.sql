-- V228 — backfill ALTER'ов employee_assignments, которые на проде уже применены, но миграции для них нет.
-- Источник: D-136 в _DIFF-LEDGER.md (2026-06-17).
-- V001:742-747 объявил только 4 колонки (id, employee_id, work_id, created_at), на проде 25.
-- Без миграции свежая установка не создаст 22 недостающие колонки → код упадёт.
-- Idempotent: все ADD COLUMN IF NOT EXISTS, типы verbatim с прода.

ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS date_from              DATE;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS date_to                DATE;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS role                   VARCHAR(100);
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMP DEFAULT NOW();
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS field_role             VARCHAR(30) DEFAULT 'worker';
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS tariff_id              INTEGER;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS tariff_points          INTEGER;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS combination_tariff_id  INTEGER;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS per_diem               NUMERIC(10,2);
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS shift_type             VARCHAR(20) DEFAULT 'day';
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS is_active              BOOLEAN DEFAULT true;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS sms_sent               BOOLEAN DEFAULT false;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS sms_sent_at            TIMESTAMP;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS departure_date         DATE;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS departure_reason       VARCHAR(255);
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS max_invite_sent_at     TIMESTAMPTZ;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS max_joined_at          TIMESTAMPTZ;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS max_user_id            VARCHAR(64);
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS max_invite_status      VARCHAR(20) DEFAULT 'not_sent';
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS wa_invite_sent_at      TIMESTAMPTZ;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS wa_joined_at           TIMESTAMPTZ;
ALTER TABLE employee_assignments ADD COLUMN IF NOT EXISTS wa_invite_status       TEXT DEFAULT 'not_sent';

-- Триггер update_updated_at для employee_assignments на проде НЕ существует
-- (проверено: pg_trigger содержит только RI_ConstraintTrigger_*, функция update_updated_at_column отсутствует).
-- CREATE TRIGGER не добавляем.
