-- Smoke-тест миграции V218 + допустимости subcategory/payment_method
DELETE FROM work_expenses WHERE source_table = 'test_v218';

-- Insert
INSERT INTO work_expenses (work_id, category, subcategory, amount, payment_method,
                            description, supplier, date, status, source_table, source_key)
VALUES (11, 'cash', 'gsm', 2027.70, 'cash', 'TEBOIL benzin', 'TEBOIL', '2026-05-31',
        'confirmed', 'test_v218', 'test:1')
RETURNING id, category, subcategory, payment_method, amount;

-- Verify
SELECT id, category, subcategory, payment_method, amount
FROM work_expenses
WHERE source_table = 'test_v218';

-- Cleanup
DELETE FROM work_expenses WHERE source_table = 'test_v218';
