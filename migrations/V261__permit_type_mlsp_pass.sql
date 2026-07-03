-- V261: добавить тип допуска «Пропуск МЛСП»
-- Используется в карточке Дружины (колонка МЛСП) и в employee_permits.
-- Категория: offshore (как у BOSIET/SLEEVE — пропуска для морских объектов).
INSERT INTO permit_types (code, name, category, is_active, created_at)
SELECT 'MLSP_PASS', 'Пропуск МЛСП', 'offshore', true, NOW()
WHERE NOT EXISTS (SELECT 1 FROM permit_types WHERE code='MLSP_PASS');
