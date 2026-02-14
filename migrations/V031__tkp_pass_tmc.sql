-- V031: Добавление недостающих столбцов к tkp, pass_requests, tmc_requests
-- Таблицы уже существуют из предыдущей миграции, добавляем недостающие поля
-- =============================================

-- TKP: добавить столбцы для расширенного функционала
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS work_id INT REFERENCES works(id) ON DELETE SET NULL;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS services TEXT;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS deadline TEXT;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS validity_days INT DEFAULT 30;
ALTER TABLE tkp ADD COLUMN IF NOT EXISTS sent_by INT REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_tkp_author ON tkp(author_id);

-- Pass requests: добавить столбцы
ALTER TABLE pass_requests ADD COLUMN IF NOT EXISTS request_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE pass_requests ADD COLUMN IF NOT EXISTS equipment_json JSONB DEFAULT '[]';
ALTER TABLE pass_requests ADD COLUMN IF NOT EXISTS contact_person TEXT;
ALTER TABLE pass_requests ADD COLUMN IF NOT EXISTS contact_phone TEXT;
ALTER TABLE pass_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_pass_requests_dates ON pass_requests(date_from, date_to);

-- TMC requests: добавить столбцы
ALTER TABLE tmc_requests ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE tmc_requests ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'normal';
ALTER TABLE tmc_requests ADD COLUMN IF NOT EXISTS needed_by DATE;
ALTER TABLE tmc_requests ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE tmc_requests ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_tmc_requests_priority ON tmc_requests(priority);

-- Обновить title из request_type для существующих записей TMC
UPDATE tmc_requests SET title = request_type WHERE title IS NULL AND request_type IS NOT NULL;
