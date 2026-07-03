-- V257 DOWN: вернуть прежний CHECK (subcategory только для cash/subcontract).
-- ВНИМАНИЕ: subcategory у materials/tickets/accommodation/transfer останется заполненной,
-- это не сломает CHECK — но новый constraint их запретит. Сначала чистим, потом ALTER.

UPDATE work_expenses
   SET subcategory = NULL
 WHERE category IN ('materials','tickets','accommodation','transfer');

ALTER TABLE work_expenses DROP CONSTRAINT IF EXISTS chk_work_expenses_subcategory;
ALTER TABLE work_expenses ADD CONSTRAINT chk_work_expenses_subcategory
  CHECK (
    subcategory IS NULL
    OR (category = 'cash' AND subcategory IN ('gsm','accommodation','transport','food','supplies','representational','services','other'))
    OR (category = 'subcontract' AND subcategory IN ('lathe','welder','other_contractor'))
  );
