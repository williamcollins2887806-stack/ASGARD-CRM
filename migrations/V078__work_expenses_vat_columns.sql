-- V078: Добавить НДС колонки в work_expenses
-- vat_rate: ставка НДС (0, 10, 20, 22) — NULL = без НДС
-- vat_amount: сумма НДС в рублях
-- amount_ex_vat: сумма без НДС (авто-вычисляется если не задана)
-- Нужно для корректного расчёта НДС к вычету в фин. отчёте

ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS vat_rate NUMERIC(4,1);
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS vat_amount NUMERIC(14,2);
ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS amount_ex_vat NUMERIC(14,2);

-- Для существующих записей с НДС (materials с поставщиками на ОСНО):
-- Пока оставляем NULL — заполним при обновлении расходов

COMMENT ON COLUMN work_expenses.vat_rate IS 'Ставка НДС: 0/10/20/22. NULL = без НДС (УСН/НПД/ИП)';
COMMENT ON COLUMN work_expenses.vat_amount IS 'Сумма НДС в рублях (входящий НДС, к вычету)';
COMMENT ON COLUMN work_expenses.amount_ex_vat IS 'Сумма без НДС. Если NULL — amount считается без НДС';
