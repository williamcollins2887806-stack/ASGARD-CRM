-- Убрать тестовых/системных пользователей из графика офиса (staff + staff_plan).
-- Сами аккаунты users (login test_*) не трогаем — нужны для QA-логина.

DELETE FROM staff_plan
WHERE staff_id IN (
  SELECT s.id
  FROM staff s
  JOIN users u ON u.id = s.user_id
  WHERE u.login ~ '^test_' OR u.login = 'mimir_bot'
);

DELETE FROM staff
WHERE user_id IN (
  SELECT id FROM users WHERE login ~ '^test_' OR login = 'mimir_bot'
);

-- На случай осиротевших строк с display name «Test …» без привязки к user_id
DELETE FROM staff_plan
WHERE staff_id IN (
  SELECT id FROM staff
  WHERE user_id IS NULL
    AND (name ILIKE 'Test %' OR name ILIKE 'Тест %')
);

DELETE FROM staff
WHERE user_id IS NULL
  AND (name ILIKE 'Test %' OR name ILIKE 'Тест %');
