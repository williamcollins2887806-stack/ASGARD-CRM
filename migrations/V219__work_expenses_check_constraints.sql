-- V219: CHECK-constraints на work_expenses + чистка категорий до канонического набора.
--
-- Закрывает корневую причину семейства багов: category был свободным VARCHAR.
-- Из-за этого field-funds мог писать 'Материалы' (кириллица), новые fields
-- могли войти как 'travel'/'food'/'fuel' из React v2 — а TAX_CATEGORIES их не
-- матчил, налог не начислялся, и никто этого не замечал.
--
-- После V219:
--   - category — закрытый набор (9 значений) — INSERT мусора падает с ошибкой
--   - payment_method — закрытый набор (5 значений) + NOT NULL + DEFAULT 'cash'
--   - subcategory — допустима только под cash/subcontract по конкретному списку
--
-- Источник правды для всех списков: src/services/work-expense-categories.js
-- Менять set категорий → менять и здесь (новая миграция), и в .js, синхронно.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Cleanup: нормализация существующих категорий → канонический набор
-- ─────────────────────────────────────────────────────────────────────

-- Legacy → canonical
UPDATE work_expenses SET category = 'fot'           WHERE category = 'payroll';
UPDATE work_expenses SET category = 'tickets'       WHERE category = 'travel';
UPDATE work_expenses SET category = 'transfer'      WHERE category = 'transport';
UPDATE work_expenses SET category = 'accommodation' WHERE category = 'lodging';
UPDATE work_expenses SET category = 'materials'     WHERE category IN ('tools','chemicals','equipment');
UPDATE work_expenses SET category = 'transfer'      WHERE category = 'logistics';

-- 'food' / 'fuel' были category в React v2 — переезжают в cash + subcategory
UPDATE work_expenses SET category = 'cash',
                         subcategory = COALESCE(subcategory, 'food')
WHERE category = 'food';

UPDATE work_expenses SET category = 'cash',
                         subcategory = COALESCE(subcategory, 'gsm')
WHERE category = 'fuel';

-- Кириллица из старой мобилки (field-funds до фикса)
UPDATE work_expenses SET category = 'cash',
                         subcategory = COALESCE(subcategory, 'supplies')
WHERE category IN ('Материалы','Инструмент','Расходники');

UPDATE work_expenses SET category = 'transfer'
WHERE category = 'Транспорт';

UPDATE work_expenses SET category = 'cash',
                         subcategory = COALESCE(subcategory, 'food')
WHERE category = 'Питание';

UPDATE work_expenses SET category = 'other'
WHERE category IN ('Прочее','Полевые расходы');

UPDATE work_expenses SET category = 'other'
WHERE category IS NULL OR category = '';

-- ─────────────────────────────────────────────────────────────────────
-- 2. payment_method: NULL → 'cash' (default для старых записей)
-- ─────────────────────────────────────────────────────────────────────
UPDATE work_expenses SET payment_method = 'cash' WHERE payment_method IS NULL;

-- Старые невалидные значения payment_method, если вдруг есть, → cash
UPDATE work_expenses SET payment_method = 'cash'
WHERE payment_method NOT IN ('cash', 'card', 'bank', 'self', 'auto');

-- ─────────────────────────────────────────────────────────────────────
-- 3. Subcategory: невалидные значения → NULL, чтобы не уронить constraint
-- ─────────────────────────────────────────────────────────────────────
UPDATE work_expenses SET subcategory = NULL
WHERE subcategory IS NOT NULL
  AND NOT (
    (category = 'cash' AND subcategory IN ('gsm','accommodation','transport','food','supplies','representational','services','other'))
    OR (category = 'subcontract' AND subcategory IN ('lathe','welder','other_contractor'))
  );

-- ─────────────────────────────────────────────────────────────────────
-- 4. CHECK-constraints + NOT NULL + DEFAULT
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE work_expenses
  ALTER COLUMN payment_method SET DEFAULT 'cash';

ALTER TABLE work_expenses
  ALTER COLUMN payment_method SET NOT NULL;

ALTER TABLE work_expenses DROP CONSTRAINT IF EXISTS chk_work_expenses_category;
ALTER TABLE work_expenses ADD CONSTRAINT chk_work_expenses_category
  CHECK (category IN ('cash', 'subcontract', 'per_diem', 'fot',
                       'materials', 'tickets', 'accommodation', 'transfer', 'other'));

ALTER TABLE work_expenses DROP CONSTRAINT IF EXISTS chk_work_expenses_payment_method;
ALTER TABLE work_expenses ADD CONSTRAINT chk_work_expenses_payment_method
  CHECK (payment_method IN ('cash', 'card', 'bank', 'self', 'auto'));

ALTER TABLE work_expenses DROP CONSTRAINT IF EXISTS chk_work_expenses_subcategory;
ALTER TABLE work_expenses ADD CONSTRAINT chk_work_expenses_subcategory
  CHECK (
    subcategory IS NULL
    OR (category = 'cash' AND subcategory IN ('gsm','accommodation','transport','food','supplies','representational','services','other'))
    OR (category = 'subcontract' AND subcategory IN ('lathe','welder','other_contractor'))
  );

COMMENT ON CONSTRAINT chk_work_expenses_category ON work_expenses IS
  'Канонический набор категорий. Источник правды — src/services/work-expense-categories.js';
COMMENT ON CONSTRAINT chk_work_expenses_payment_method ON work_expenses IS
  'cash/card/bank/self/auto. expense-tax.js решает 55%-нагрузку по этому полю.';
COMMENT ON CONSTRAINT chk_work_expenses_subcategory ON work_expenses IS
  'Подкатегория допустима ТОЛЬКО под cash и subcontract из закрытого списка.';
