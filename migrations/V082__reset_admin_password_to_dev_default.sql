-- V082: Восстановление дефолтного dev-пароля admin для e2e-тестов
-- helpers.js ожидает 'admin123', предыдущая ручная правка через bcrypt сбила синхронизацию
-- PIN остаётся '1234' (helpers.js: pin: '1234')
UPDATE users
SET password_hash = '$2a$10$tc.k4xEvQFelHFtfv5AnLufA63IkSSDf0IejzqedckdxshvJ.SYsi',
    updated_at = NOW()
WHERE login = 'admin';
