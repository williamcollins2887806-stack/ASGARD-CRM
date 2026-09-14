-- V297: РМРС в разделе «Сварка» (рядом с НАКС) + нормализация role_tag «Сварщик»→«сварщик».

-- 1) Аттестация РМРС рядом с НАКС (sort_order 865 — между НАКС 860 и offshore 900)
INSERT INTO permit_types (code, name, category, validity_months, sort_order, is_active, created_at)
SELECT v.code, v.name, v.category, v.validity_months, v.sort_order, true, NOW()
FROM (VALUES
  ('RMRS', 'Аттестация сварщика РМРС', 'welding', 24, 865)
) AS v(code, name, category, validity_months, sort_order)
WHERE NOT EXISTS (
  SELECT 1 FROM permit_types pt
  WHERE upper(pt.code) = upper(v.code)
     OR lower(pt.name) = lower(v.name)
);

-- 2) Объединить дубли специальностей: Title Case / смесь → канон lowercase
--    Канон из src/lib/employee-role-tags.js + частые значения формы «Добавить».
UPDATE employees
SET role_tag = lower(trim(role_tag))
WHERE role_tag IS NOT NULL
  AND btrim(role_tag) <> ''
  AND role_tag <> lower(trim(role_tag))
  AND lower(trim(role_tag)) IN (
    'слесарь',
    'сварщик',
    'альпинист',
    'мастер',
    'оператор вд',
    'наблюдающий (вд)',
    'слесарь-сантехник',
    'электромонтажник',
    'стропальщик',
    'мастер участка',
    'подсобный рабочий',
    'монтажник'
  );

-- «РП» оставляем как есть (специальный тег с заглавными).
