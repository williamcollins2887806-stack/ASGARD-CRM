-- V291: объединить дубли справочника permit_types и перенести employee_permits.
-- Канон — коды V267 (EB_II, PB_B*, SIZ_USE, …); legacy EB_2/ATTEST_* деактивируем.

CREATE TEMP TABLE permit_type_merge (
  old_code TEXT NOT NULL,
  new_code TEXT NOT NULL,
  old_id   INTEGER,
  new_id   INTEGER
);

INSERT INTO permit_type_merge (old_code, new_code) VALUES
  -- Электробезопасность (дубли в UI)
  ('EB_2', 'EB_II'),
  ('EB_3', 'EB_III'),
  ('EB_4', 'EB_IV'),
  ('EB_5', 'EB_V'),
  -- Аттестации ПБ: старые ATTEST_* → канон PB_*
  ('ATTEST_A1', 'PB_A1'),
  ('ATTEST_B1', 'PB_B1'),
  ('ATTEST_B2', 'PB_B2'),
  ('ATTEST_B3', 'PB_B3'),
  ('ATTEST_B4', 'PB_B4'),
  ('ATTEST_B5', 'PB_B5'),
  ('ATTEST_B6', 'PB_B6'),
  ('ATTEST_B7', 'PB_B7'),
  ('ATTEST_B8', 'PB_B8'),
  ('ATTEST_B9', 'PB_B9'),
  ('ATTEST_B10', 'PB_B10'),
  ('ATTEST_B11', 'PB_B11'),
  ('ATTEST_B12', 'PB_B12'),
  ('ATTEST_G1', 'PB_G1'),
  ('ATTEST_G2', 'PB_G2'),
  ('ATTEST_G3', 'PB_G3'),
  -- Прочие синонимы каталога
  ('WELD_MIG', 'WELD_MIG_MAG'),
  ('SIZ', 'SIZ_USE'),
  ('NDT_UT', 'NDT_UZK'),
  ('NDT_RT', 'NDT_RK'),
  ('NDT_MT', 'NDT_MPK'),
  ('NDT_PT', 'NDT_PVK'),
  ('GASCUTTER', 'GAS_CUTTING'),
  ('MED_PERIODIC', 'MED_EXAM'),
  ('MED_PRELIMINARY', 'MED_EXAM_PRELIM'),
  ('PSYCH', 'PSYCH_EXAM');

UPDATE permit_type_merge m
   SET old_id = o.id,
       new_id = n.id
  FROM permit_types o,
       permit_types n
 WHERE o.code = m.old_code
   AND n.code = m.new_code
   AND o.id <> n.id;

DELETE FROM permit_type_merge WHERE old_id IS NULL OR new_id IS NULL;

-- Требования на работах
UPDATE work_permit_requirements wpr
   SET permit_type_id = m.new_id
  FROM permit_type_merge m
 WHERE wpr.permit_type_id = m.old_id
   AND NOT EXISTS (
     SELECT 1 FROM work_permit_requirements x
      WHERE x.work_id = wpr.work_id
        AND x.permit_type_id = m.new_id
        AND COALESCE(x.role_key, '') = COALESCE(wpr.role_key, '')
   );

DELETE FROM work_permit_requirements wpr
 USING permit_type_merge m
 WHERE wpr.permit_type_id = m.old_id;

-- Все допуски рабочих → канонический type_id
UPDATE employee_permits ep
   SET type_id = m.new_id,
       updated_at = NOW()
  FROM permit_type_merge m
 WHERE ep.type_id = m.old_id;

-- Оставить один актуальный допуск на (employee_id, type_id)
UPDATE employee_permits a
   SET is_active = false,
       updated_at = NOW()
 WHERE a.is_active = true
   AND EXISTS (
     SELECT 1 FROM employee_permits b
      WHERE b.employee_id = a.employee_id
        AND b.type_id     = a.type_id
        AND b.is_active   = true
        AND b.id <> a.id
        AND (
              (b.expiry_date IS NULL AND a.expiry_date IS NOT NULL)
           OR (b.expiry_date IS NOT NULL AND a.expiry_date IS NOT NULL AND b.expiry_date > a.expiry_date)
           OR (COALESCE(b.expiry_date, DATE '9999-12-31') = COALESCE(a.expiry_date, DATE '9999-12-31') AND b.id > a.id)
        )
   );

-- Скрыть legacy-типы из справочника
UPDATE permit_types pt
   SET is_active = false,
       updated_at = NOW()
  FROM permit_type_merge m
 WHERE pt.id = m.old_id;

DROP TABLE permit_type_merge;
