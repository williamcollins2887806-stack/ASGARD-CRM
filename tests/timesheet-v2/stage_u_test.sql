INSERT INTO employees (fio, position, is_active, is_officially_employed, official_salary, official_non_burnable, official_status, created_at)
VALUES
  ('TEST-U-A 80k pol30k actv',  'Тестовый', true, true, 60000, 30000, 'active', NOW()),
  ('TEST-U-B 80k 0 actv',       'Тестовый', true, true, 60000, 0,     'active', NOW()),
  ('TEST-U-C 20k pol30k actv',  'Тестовый', true, true, 60000, 30000, 'active', NOW()),
  ('TEST-U-D 0 pol30k actv',    'Тестовый', true, true, 60000, 30000, 'active', NOW()),
  ('TEST-U-E 0 pol30k unpaid',  'Тестовый', true, true, 60000, 30000, 'unpaid_leave', NOW()),
  ('TEST-U-F 0 bezpola actv',   'Тестовый', true, true, 60000, 0,     'active', NOW())
RETURNING id, fio;
