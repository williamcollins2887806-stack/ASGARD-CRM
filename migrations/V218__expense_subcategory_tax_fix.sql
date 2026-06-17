-- V218: subcategory на work_expenses + комментарий по логике 55%/НДС
--
-- 1. Добавляем колонку subcategory для детализации под основной category
--    Под 'cash':         gsm | accommodation | transport | food | supplies | representational | services | other
--    Под 'subcontract':  lathe | welder | other_contractor
--    Под остальными:     NULL (детализация не нужна)
--
-- 2. История багов, которые этот патч НЕ трогает (для контекста):
--    - V081 строка 31-33: `payment_method IS NULL AND … LIKE 'Еськова%' OR … LIKE 'Ананиев%'`
--      из-за приоритета операторов помечал self ВСЕ записи с «Ананиев», даже не аренду авто.
--      Cleanup данных — отдельной миграцией если потребуется, текущая логика 55%-расчёта
--      (см. src/services/expense-tax.js) корректно работает с правильно заполненными payment_method.

ALTER TABLE work_expenses
  ADD COLUMN IF NOT EXISTS subcategory VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_work_expenses_subcategory
  ON work_expenses(subcategory) WHERE subcategory IS NOT NULL;

COMMENT ON COLUMN work_expenses.subcategory IS
  'Подкатегория детализации под category. Для cash: gsm, accommodation, transport, food, supplies, representational, services, other. Для subcontract: lathe, welder, other_contractor.';
