-- Эмулируем earned через pending bonus (входит в earned, но не в paid)
INSERT INTO worker_payments (employee_id, type, amount, status, pay_year, pay_month, created_at)
SELECT id, 'bonus', 80000, 'pending', 2026, 6, NOW()
FROM employees WHERE fio = 'TEST-U-A 80k pol30k actv'
UNION ALL
SELECT id, 'bonus', 80000, 'pending', 2026, 6, NOW()
FROM employees WHERE fio = 'TEST-U-B 80k 0 actv'
UNION ALL
SELECT id, 'bonus', 20000, 'pending', 2026, 6, NOW()
FROM employees WHERE fio = 'TEST-U-C 20k pol30k actv'
RETURNING id, employee_id, amount;
