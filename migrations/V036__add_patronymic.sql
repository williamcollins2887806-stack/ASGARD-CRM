-- V036: Add patronymic column to users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS patronymic VARCHAR(255);
COMMENT ON COLUMN users.patronymic IS 'Отчество пользователя';
