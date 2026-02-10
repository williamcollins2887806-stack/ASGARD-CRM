-- ═══════════════════════════════════════════════════════════════════════════
-- V028: Исправление ошибок из pm2 логов
-- 1. correspondence.body — mailbox.js вставляет, но колонка может отсутствовать
-- 2. employees.department — mimir-data.js и дашборд запрашивают
-- 3. mimir_usage_log — ослабляем NOT NULL на provider/model (fallback 'unknown')
-- Идемпотентная миграция
-- ═══════════════════════════════════════════════════════════════════════════

-- correspondence.body — для автоматической регистрации исходящих писем
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS body TEXT;

-- employees.department — для группировки по отделам в дашборде и Mimir
ALTER TABLE employees ADD COLUMN IF NOT EXISTS department VARCHAR(100);

-- mimir_usage_log — ослабляем NOT NULL, чтобы INSERT не падал если AI не настроен
ALTER TABLE mimir_usage_log ALTER COLUMN provider SET DEFAULT 'unknown';
ALTER TABLE mimir_usage_log ALTER COLUMN provider DROP NOT NULL;
ALTER TABLE mimir_usage_log ALTER COLUMN model SET DEFAULT 'unknown';
ALTER TABLE mimir_usage_log ALTER COLUMN model DROP NOT NULL;

SELECT 'V028 applied successfully' as result;
