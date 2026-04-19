-- V081: Способ оплаты в work_expenses
-- 55% налоговая нагрузка считается по payment_method, а не по category
--
-- Значения:
--   'cash'     — наличные (55% нагрузка)
--   'card'     — корпоративная карта на месте (55% нагрузка)
--   'bank'     — безнал по счёту (без 55%, есть НДС к вычету)
--   'self'     — самозанятый/НПД (без 55%, без НДС)
--   'auto'     — автоматический (ФОТ из checkins, суточные)

ALTER TABLE work_expenses ADD COLUMN IF NOT EXISTS payment_method VARCHAR(20);

-- Заполняем существующие записи
-- ФОТ и суточные (автоматические) → auto
UPDATE work_expenses SET payment_method = 'auto'
WHERE payment_method IS NULL AND source_table IN ('field_checkins_agg', 'worker_payments');

-- Материалы от поставщиков (безнал) → bank
UPDATE work_expenses SET payment_method = 'bank'
WHERE payment_method IS NULL AND category = 'materials' AND source_table = 'manual'
  AND supplier IN ('ВсеИнструменты.ру', 'САТУРН-СЕРВИС', 'ПРАБО', 'OZON', 'ФОРИН', 'ИП Шакуров');

-- Проживание (безнал/ИП) → bank
UPDATE work_expenses SET payment_method = 'bank'
WHERE payment_method IS NULL AND category = 'accommodation';

-- Билеты (безнал через Trivio/S7) → bank
UPDATE work_expenses SET payment_method = 'bank'
WHERE payment_method IS NULL AND category = 'tickets' AND description NOT LIKE '%Наличные%';

-- Аренда авто (самозанятые) → self
UPDATE work_expenses SET payment_method = 'self'
WHERE payment_method IS NULL AND description LIKE '%Еськова%' OR description LIKE '%Ананиев%';

-- Логистика (безнал) → bank
UPDATE work_expenses SET payment_method = 'bank'
WHERE payment_method IS NULL AND description LIKE '%МОДЕРН ТРАНС%';

-- Всё оставшееся без payment_method → cash (наличные покупки)
UPDATE work_expenses SET payment_method = 'cash'
WHERE payment_method IS NULL AND work_id = 11;

COMMENT ON COLUMN work_expenses.payment_method IS 'Способ оплаты: cash/card/bank/self/auto. 55% налог начисляется на cash+card+auto(fot/per_diem)';
