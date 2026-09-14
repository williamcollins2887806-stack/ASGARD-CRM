-- V314: физ. объём во всех направлениях — убрать primary «сут/шт» без размеров
-- Правило: м² / м³ / м / трубки×Ø×L / Ду+длина. «шт» — только справка.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Трубные пучки — Ø/L обязательны в schema
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"gdo","label":"ГДО","primary_rate_code":"tubes_min_per_tube","derived_metric":"min_per_tube","volume_unit":"трубки"},
    {"code":"gmo","label":"ГМО","primary_rate_code":"tubes_per_shift_gmo","derived_metric":"tubes_per_shift","volume_unit":"трубки"},
    {"code":"chem","label":"Химциркуляция","primary_rate_code":"tubes_chem_100","derived_metric":"mh_per_100_tubes","volume_unit":"трубки"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "gdo":{"fields":[
        {"key":"tubes","label":"Трубки","unit":"шт"},
        {"key":"diameter_mm","label":"Ø","unit":"мм"},
        {"key":"length_m","label":"Длина трубки","unit":"м"},
        {"key":"bundle_pull","label":"Выемка пучка","type":"checkbox","optional":true},
        {"key":"shell_side","label":"Межтрубное / кожух","type":"checkbox","optional":true}
      ]},
      "gmo":{"fields":[
        {"key":"tubes","label":"Трубки","unit":"шт"},
        {"key":"diameter_mm","label":"Ø","unit":"мм"},
        {"key":"length_m","label":"Длина трубки","unit":"м","optional":true}
      ]},
      "chem":{"fields":[
        {"key":"tubes","label":"Трубки","unit":"шт"},
        {"key":"circuit_m3","label":"Объём контура","unit":"м³"},
        {"key":"cycles","label":"Циклы","unit":"шт","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "gdo":{"volume_unit":"трубки","derived_metric":"min_per_tube","fields":[
        {"key":"volume_value","label":"Трубки","unit":"шт","role":"volume"},
        {"key":"diameter_mm","label":"Ø","unit":"мм","role":"diameter"},
        {"key":"length_m","label":"Длина трубки","unit":"м","role":"length"},
        {"key":"qty","label":"Аппараты (справка)","unit":"шт","role":"qty","optional":true}
      ]},
      "gmo":{"volume_unit":"трубки","derived_metric":"tubes_per_shift","fields":[
        {"key":"volume_value","label":"Трубки","unit":"шт","role":"volume"},
        {"key":"diameter_mm","label":"Ø","unit":"мм","role":"diameter"},
        {"key":"length_m","label":"Длина","unit":"м","role":"length","optional":true}
      ]},
      "chem":{"volume_unit":"трубки","derived_metric":"mh_per_100_tubes","fields":[
        {"key":"volume_value","label":"Трубки","unit":"шт","role":"volume"},
        {"key":"circuit_m3","label":"Контур","unit":"м³","role":"extra"},
        {"key":"cycles","label":"Циклы","unit":"шт","role":"extra","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'Срок от трубок×Ø×L (ГДО) / труб/смену (ГМО) / чел·ч/100 труб + м³ контура (хим). Аппарат — справка.',
  updated_at = NOW()
WHERE code = 'tubes';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Пластинчатые — м², не сут/аппарат
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"hydro_dis","label":"Разборная ГДО","primary_rate_code":"plates_m2_shift","derived_metric":"m2_per_shift","volume_unit":"м2"},
    {"code":"chem_cip","label":"Безразборная химия","primary_rate_code":"plates_cip_hours","derived_metric":"hours_per_cycle","volume_unit":"циклы"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "hydro_dis":{"fields":[
        {"key":"surface_m2","label":"Площадь пластин","unit":"м²"},
        {"key":"plates_count","label":"Число пластин","unit":"шт","optional":true},
        {"key":"area_per_plate_m2","label":"м² на пластину (если нет площади)","unit":"м²","optional":true},
        {"key":"apparatus","label":"Аппараты (справка)","unit":"шт","optional":true},
        {"key":"gasket_replace","label":"Замена уплотнений","type":"checkbox","optional":true}
      ]},
      "chem_cip":{"fields":[
        {"key":"circuit_m3","label":"Объём контура","unit":"м³"},
        {"key":"cycles","label":"Циклы","unit":"шт"},
        {"key":"conc_pct","label":"Концентрация","unit":"%","optional":true},
        {"key":"apparatus","label":"Аппараты (справка)","unit":"шт","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "hydro_dis":{"volume_unit":"м2","derived_metric":"m2_per_shift","fields":[
        {"key":"volume_value","label":"Площадь пластин","unit":"м²","role":"volume"},
        {"key":"plates_count","label":"Пластин","unit":"шт","role":"extra","optional":true},
        {"key":"qty","label":"Аппараты (справка)","unit":"шт","role":"qty","optional":true}
      ]},
      "chem_cip":{"volume_unit":"циклы","derived_metric":"hours_per_cycle","fields":[
        {"key":"circuit_m3","label":"Контур","unit":"м³","role":"extra"},
        {"key":"cycles","label":"Циклы","unit":"шт","role":"extra"},
        {"key":"hours_fact","label":"Часы факта","unit":"ч","role":"extra"}
      ]}
    }
  }'::jsonb,
  notes = 'Разбор: м² пластин (не сут/аппарат). CIP: м³ контура × циклы → ч/цикл.',
  updated_at = NOW()
WHERE code = 'plates';

UPDATE work_norm_rates SET
  notes = COALESCE(notes,'') || ' [PRIMARY разбор: м²/смену. days_per_app — справка]',
  sort_order = 5,
  updated_at = NOW()
WHERE code = 'plates_m2_shift';

UPDATE work_norm_rates SET
  notes = COALESCE(notes,'') || ' [не primary: аппараты разного размера — используйте м²]',
  updated_at = NOW()
WHERE code = 'plates_days_per_app';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Котлы — м² / м³+циклы, не сут/котёл
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"chem","label":"Химия","primary_rate_code":"boiler_chem_hours","derived_metric":"hours_per_cycle","volume_unit":"циклы"},
    {"code":"hydro","label":"Гидро","primary_rate_code":"boiler_hydro_m2_shift","derived_metric":"m2_per_shift","volume_unit":"м2"},
    {"code":"mech","label":"Механика","primary_rate_code":"boiler_mech_m2_shift","derived_metric":"m2_per_shift","volume_unit":"м2"},
    {"code":"complex","label":"Комплекс","primary_rate_code":"boiler_complex_m2_shift","derived_metric":"m2_per_shift","volume_unit":"м2"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "chem":{"fields":[
        {"key":"circuit_m3","label":"Объём контура","unit":"м³"},
        {"key":"cycles","label":"Циклы","unit":"шт"},
        {"key":"power_gcal_h","label":"Мощность (справка)","unit":"Гкал/ч","optional":true},
        {"key":"boilers","label":"Котлы (справка)","unit":"шт","optional":true},
        {"key":"acid","label":"Кислотная промывка","type":"checkbox","optional":true}
      ]},
      "hydro":{"fields":[
        {"key":"surface_m2","label":"Площадь нагрева","unit":"м²"},
        {"key":"boilers","label":"Котлы (справка)","unit":"шт","optional":true}
      ]},
      "mech":{"fields":[
        {"key":"surface_m2","label":"Площадь внутренней поверхности","unit":"м²"},
        {"key":"boilers","label":"Котлы (справка)","unit":"шт","optional":true},
        {"key":"ozp","label":"ОЗП (внутри)","type":"checkbox","optional":true}
      ]},
      "complex":{"fields":[
        {"key":"surface_m2","label":"Площадь","unit":"м²"},
        {"key":"circuit_m3","label":"Объём контура","unit":"м³"},
        {"key":"cycles","label":"Циклы химии","unit":"шт","optional":true},
        {"key":"boilers","label":"Котлы (справка)","unit":"шт","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "chem":{"volume_unit":"циклы","derived_metric":"hours_per_cycle","fields":[
        {"key":"circuit_m3","label":"Контур","unit":"м³","role":"extra"},
        {"key":"cycles","label":"Циклы","unit":"шт","role":"extra"},
        {"key":"hours_fact","label":"Часы факта","unit":"ч","role":"extra"}
      ]},
      "hydro":{"volume_unit":"м2","derived_metric":"m2_per_shift","fields":[
        {"key":"volume_value","label":"Площадь нагрева","unit":"м²","role":"volume"}
      ]},
      "mech":{"volume_unit":"м2","derived_metric":"m2_per_shift","fields":[
        {"key":"volume_value","label":"Площадь","unit":"м²","role":"volume"}
      ]},
      "complex":{"volume_unit":"м2","derived_metric":"m2_per_shift","fields":[
        {"key":"volume_value","label":"Площадь","unit":"м²","role":"volume"},
        {"key":"circuit_m3","label":"Контур","unit":"м³","role":"extra","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'Срок от м² нагрева / м³ контура×циклы. Котёл как шт — справка. ГЭСНп — только notes.',
  updated_at = NOW()
WHERE code = 'boilers';

INSERT INTO work_norm_rates (
  category_code, method_code, code, name, unit, calc_kind,
  rate_loose, rate_medium, rate_hard, rate_default,
  crew_json, params_json, basis, notes, sort_order
) VALUES
('boilers', 'chem', 'boiler_chem_hours', 'Химочистка котла — ч/цикл', 'ч/цикл', 'hours_per_cycle',
  8, 12, 20, 12,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb,
  '{"acid_mult":1.15}'::jsonb,
  'research', 'PRIMARY химия: часы×циклы; м³ — реагент. Не сут/котёл.', 5),
('boilers', 'hydro', 'boiler_hydro_m2_shift', 'Гидро котла — м²/смену', 'м²/смену', 'per_unit_shift',
  20, 12, 6, 12,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research', 'PRIMARY гидро: площадь нагрева', 15),
('boilers', 'mech', 'boiler_mech_m2_shift', 'Механика котла — м²/смену', 'м²/смену', 'per_unit_shift',
  15, 10, 5, 10,
  '{"master":1,"exec":4,"observer_rule":"1:1"}'::jsonb,
  '{"ozp":true}'::jsonb,
  'research', 'PRIMARY механика: внутренняя поверхность + ОЗП', 25),
('boilers', 'complex', 'boiler_complex_m2_shift', 'Комплекс котла — м²/смену (ориентир)', 'м²/смену', 'per_unit_shift',
  10, 6, 3, 6,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research', 'PRIMARY комплекс по площади; при circuit — доп. часы химии в calc', 35)
ON CONFLICT (category_code, code) DO UPDATE SET
  calc_kind = EXCLUDED.calc_kind,
  rate_loose = EXCLUDED.rate_loose,
  rate_medium = EXCLUDED.rate_medium,
  rate_hard = EXCLUDED.rate_hard,
  rate_default = EXCLUDED.rate_default,
  params_json = EXCLUDED.params_json,
  notes = EXCLUDED.notes,
  updated_at = NOW();

UPDATE work_norm_rates SET
  notes = COALESCE(notes,'') || ' [не primary: используйте м² / ч×циклы]',
  updated_at = NOW()
WHERE code IN ('boiler_chem_days','boiler_hydro_days','boiler_mech_days','boiler_complex_days','boiler_chem_mh');

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. Ёмкости — volume_m3 required (schema label)
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE work_norm_categories SET
  input_schema_json = '{
    "methods":{
      "clean":{"fields":[
        {"key":"volume_m3","label":"Объём","unit":"м³"},
        {"key":"deposit_cm","label":"Отложения","unit":"см","optional":true},
        {"key":"product_type","label":"Продукт (1 нефть / 2 хим / 3 вода)","unit":"","optional":true},
        {"key":"manways","label":"Люки","unit":"шт","optional":true},
        {"key":"ozp","label":"ОЗП","type":"checkbox","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'PRIMARY: чел·ч/м³ от объёма. Без м³ не считаем.',
  updated_at = NOW()
WHERE code = 'vessels';

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. Трубопроводы — length + Ду обязательны
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"chem_ops","label":"Химпромывка экспл.","primary_rate_code":"pipe_chem_circuit_hours","derived_metric":"hours_per_cycle","volume_unit":"м"},
    {"code":"pickle","label":"Протравка / предпусковая","primary_rate_code":"pipe_pickle_kg_m","derived_metric":"kg_per_m","volume_unit":"м"},
    {"code":"aspo","label":"АСПО / нефть","primary_rate_code":"pipe_aspo_m_day","derived_metric":"m_per_shift","volume_unit":"м"},
    {"code":"hydro","label":"Гидроструй","primary_rate_code":"pipe_hydro_lm","derived_metric":"m_per_shift","volume_unit":"м"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "chem_ops":{"fields":[
        {"key":"length_m","label":"Длина","unit":"м"},
        {"key":"dn_mm","label":"Ду","unit":"мм"},
        {"key":"circuit_m3","label":"Объём контура","unit":"м³","optional":true},
        {"key":"cycles","label":"Циклы","unit":"шт","optional":true}
      ]},
      "pickle":{"fields":[
        {"key":"length_m","label":"Длина","unit":"м"},
        {"key":"dn_mm","label":"Ду","unit":"мм"}
      ]},
      "aspo":{"fields":[
        {"key":"length_m","label":"Длина","unit":"м"},
        {"key":"dn_mm","label":"Ду","unit":"мм"}
      ]},
      "hydro":{"fields":[
        {"key":"length_m","label":"Длина","unit":"м.п."},
        {"key":"dn_mm","label":"Ду","unit":"мм"}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "chem_ops":{"volume_unit":"м","derived_metric":"hours_per_cycle","fields":[
        {"key":"length_m","label":"Длина","unit":"м","role":"length"},
        {"key":"dn_mm","label":"Ду","unit":"мм","role":"extra"},
        {"key":"circuit_m3","label":"Контур","unit":"м³","role":"extra","optional":true},
        {"key":"cycles","label":"Циклы","unit":"шт","role":"extra","optional":true},
        {"key":"hours_fact","label":"Часы факта","unit":"ч","role":"extra","optional":true}
      ]},
      "pickle":{"volume_unit":"м","derived_metric":"kg_per_m","fields":[
        {"key":"length_m","label":"Длина","unit":"м","role":"length"},
        {"key":"dn_mm","label":"Ду","unit":"мм","role":"extra"},
        {"key":"kg_reagent","label":"Реагент факт","unit":"кг","role":"extra"}
      ]},
      "aspo":{"volume_unit":"м","derived_metric":"m_per_shift","fields":[
        {"key":"volume_value","label":"Длина","unit":"м","role":"volume"},
        {"key":"dn_mm","label":"Ду","unit":"мм","role":"extra"}
      ]},
      "hydro":{"volume_unit":"м","derived_metric":"m_per_shift","fields":[
        {"key":"volume_value","label":"Длина","unit":"м","role":"volume"},
        {"key":"dn_mm","label":"Ду","unit":"мм","role":"extra"}
      ]}
    }
  }'::jsonb,
  notes = 'Всегда длина + Ду. Хим: при контуре — ч×циклы, иначе м/смену.',
  updated_at = NOW()
WHERE code = 'pipelines';

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Химконтуры — circuit + cycles required
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE work_norm_categories SET
  input_schema_json = '{
    "methods":{
      "cip":{"fields":[
        {"key":"circuit_m3","label":"Объём контура","unit":"м³"},
        {"key":"cycles","label":"Циклы","unit":"шт"},
        {"key":"conc_pct","label":"Концентрация","unit":"%","optional":true},
        {"key":"apparatus_count","label":"Аппаратов (справка)","unit":"шт","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "cip":{"volume_unit":"циклы","derived_metric":"hours_per_cycle","fields":[
        {"key":"circuit_m3","label":"Контур","unit":"м³","role":"extra"},
        {"key":"cycles","label":"Циклы","unit":"шт","role":"extra"},
        {"key":"hours_fact","label":"Часы факта","unit":"ч","role":"extra"}
      ]}
    }
  }'::jsonb,
  notes = 'ч/цикл × cycles; м³ → реагент, не длительность.',
  updated_at = NOW()
WHERE code = 'chem_circuits';

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. HVAC — ИТП по м³, не сут/объект
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"tower","label":"Градирня","primary_rate_code":"tower_m2_shift","derived_metric":"m2_per_shift","volume_unit":"м2"},
    {"code":"heating","label":"Отопление / ГВС / хладо","primary_rate_code":"heating_m3_shift","derived_metric":"m3_per_shift","volume_unit":"м3"},
    {"code":"itp","label":"ИТП / ЦТП","primary_rate_code":"itp_m3_shift","derived_metric":"m3_per_shift","volume_unit":"м3"},
    {"code":"pneumo","label":"Пневмоимпульс","primary_rate_code":"pneumo_m_day","derived_metric":"m_per_shift","volume_unit":"м"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "tower":{"fields":[
        {"key":"surface_m2","label":"Площадь орошения","unit":"м²"},
        {"key":"cells","label":"Ячейки (справка)","unit":"шт","optional":true},
        {"key":"biofouling","label":"Биоплёнка (тяжёлые)","type":"checkbox","optional":true}
      ]},
      "heating":{"fields":[
        {"key":"circuit_m3","label":"Объём системы","unit":"м³"},
        {"key":"points","label":"Точки (справка)","unit":"шт","optional":true}
      ]},
      "itp":{"fields":[
        {"key":"circuit_m3","label":"Объём системы","unit":"м³"},
        {"key":"objects","label":"ИТП (справка)","unit":"шт","optional":true}
      ]},
      "pneumo":{"fields":[
        {"key":"length_m","label":"Длина сети","unit":"м"},
        {"key":"dn_mm","label":"Ду","unit":"мм","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "tower":{"volume_unit":"м2","derived_metric":"m2_per_shift","fields":[
        {"key":"volume_value","label":"Площадь орошения","unit":"м²","role":"volume"}
      ]},
      "heating":{"volume_unit":"м3","derived_metric":"m3_per_shift","fields":[
        {"key":"volume_value","label":"Объём системы","unit":"м³","role":"volume"}
      ]},
      "itp":{"volume_unit":"м3","derived_metric":"m3_per_shift","fields":[
        {"key":"volume_value","label":"Объём системы","unit":"м³","role":"volume"}
      ]},
      "pneumo":{"volume_unit":"м","derived_metric":"m_per_shift","fields":[
        {"key":"volume_value","label":"Длина","unit":"м","role":"volume"},
        {"key":"dn_mm","label":"Ду","unit":"мм","role":"extra","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'ИТП — от м³ системы, не сут/объект.',
  updated_at = NOW()
WHERE code = 'towers_hvac';

INSERT INTO work_norm_rates (
  category_code, method_code, code, name, unit, calc_kind,
  rate_loose, rate_medium, rate_hard, rate_default,
  crew_json, params_json, basis, notes, sort_order
) VALUES
('towers_hvac', 'itp', 'itp_m3_shift', 'ИТП/ЦТП — м³ системы/смену', 'м³/смену', 'per_unit_shift',
  12, 8, 4, 8,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research', 'PRIMARY ИТП: объём системы. itp_days — справка.', 25)
ON CONFLICT (category_code, code) DO UPDATE SET
  calc_kind = EXCLUDED.calc_kind,
  rate_loose = EXCLUDED.rate_loose,
  rate_medium = EXCLUDED.rate_medium,
  rate_hard = EXCLUDED.rate_hard,
  rate_default = EXCLUDED.rate_default,
  notes = EXCLUDED.notes,
  updated_at = NOW();

UPDATE work_norm_rates SET
  notes = COALESCE(notes,'') || ' [не primary: объекты ИТП разного объёма — м³]',
  updated_at = NOW()
WHERE code = 'itp_days';

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. Вент / канализация
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE work_norm_categories SET
  input_schema_json = '{
    "methods":{
      "vent":{"fields":[
        {"key":"length_m","label":"Длина","unit":"м.п."},
        {"key":"dn_mm","label":"Сечение / Ду","unit":"мм","optional":true},
        {"key":"surface_m2","label":"Площадь (опц.)","unit":"м²","optional":true},
        {"key":"access_doors","label":"Лючки","unit":"шт","optional":true}
      ]},
      "disinfect":{"fields":[
        {"key":"surface_m2","label":"Площадь","unit":"м²"}
      ]},
      "sewer":{"fields":[
        {"key":"length_m","label":"Длина","unit":"м"},
        {"key":"dn_mm","label":"Ду","unit":"мм","optional":true},
        {"key":"manholes","label":"Колодцы","unit":"шт","optional":true},
        {"key":"grease","label":"Жировые отложения","type":"checkbox","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "vent":{"volume_unit":"м","derived_metric":"m_per_shift","fields":[
        {"key":"volume_value","label":"Длина","unit":"м","role":"volume"},
        {"key":"dn_mm","label":"Ду/сечение","unit":"мм","role":"extra","optional":true}
      ]},
      "disinfect":{"volume_unit":"м2","derived_metric":"m2_per_shift","fields":[
        {"key":"volume_value","label":"Площадь","unit":"м²","role":"volume"}
      ]},
      "sewer":{"volume_unit":"м","derived_metric":"m_per_shift","fields":[
        {"key":"volume_value","label":"Длина","unit":"м","role":"volume"},
        {"key":"dn_mm","label":"Ду","unit":"мм","role":"extra","optional":true}
      ]}
    }
  }'::jsonb,
  updated_at = NOW()
WHERE code = 'vent_sewer';

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. Ремонт — м² / пластины / стык+Ду
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"compabloc","label":"Компаблок","primary_rate_code":"compabloc_m2_shift","derived_metric":"m2_per_shift","volume_unit":"м2"},
    {"code":"plates_pack","label":"Пакет пластин","primary_rate_code":"plates_pack_pcs_shift","derived_metric":"plates_per_shift","volume_unit":"пластин"},
    {"code":"weld","label":"Сварка","primary_rate_code":"weld_joint_shift","derived_metric":"joints_per_shift","volume_unit":"стык"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "compabloc":{"fields":[
        {"key":"surface_m2","label":"Площадь пластин","unit":"м²"},
        {"key":"plates_count","label":"Пластин","unit":"шт","optional":true},
        {"key":"qty","label":"Аппараты (справка)","unit":"шт","optional":true}
      ]},
      "plates_pack":{"fields":[
        {"key":"plates_count","label":"Пластин всего","unit":"шт"},
        {"key":"qty","label":"Пакеты","unit":"шт","optional":true},
        {"key":"plates_in_pack","label":"Пластин в пакете","unit":"шт","optional":true},
        {"key":"surface_m2","label":"Площадь (опц.)","unit":"м²","optional":true}
      ]},
      "weld":{"fields":[
        {"key":"joints","label":"Стыки","unit":"шт"},
        {"key":"dn_mm","label":"Ду","unit":"мм"},
        {"key":"length_m","label":"Длина шва (опц.)","unit":"м","optional":true},
        {"key":"ru","label":"Ру","unit":"МПа","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "compabloc":{"volume_unit":"м2","derived_metric":"m2_per_shift","fields":[
        {"key":"volume_value","label":"Площадь","unit":"м²","role":"volume"},
        {"key":"plates_count","label":"Пластин","unit":"шт","role":"extra","optional":true}
      ]},
      "plates_pack":{"volume_unit":"пластин","derived_metric":"plates_per_shift","fields":[
        {"key":"volume_value","label":"Пластин","unit":"шт","role":"volume"}
      ]},
      "weld":{"volume_unit":"стык","derived_metric":"joints_per_shift","fields":[
        {"key":"volume_value","label":"Стыки","unit":"шт","role":"volume"},
        {"key":"dn_mm","label":"Ду","unit":"мм","role":"extra"}
      ]}
    }
  }'::jsonb,
  notes = 'Компаблок/пакет — м² или число пластин; сварка — стыки+Ду. Не сут/шт.',
  updated_at = NOW()
WHERE code = 'repair_weld';

INSERT INTO work_norm_rates (
  category_code, method_code, code, name, unit, calc_kind,
  rate_loose, rate_medium, rate_hard, rate_default,
  crew_json, params_json, basis, notes, sort_order
) VALUES
('repair_weld', 'compabloc', 'compabloc_m2_shift', 'Компаблок — м² пластин/смену', 'м²/смену', 'per_unit_shift',
  40, 25, 12, 25,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research', 'PRIMARY компаблок по площади', 5),
('repair_weld', 'plates_pack', 'plates_pack_pcs_shift', 'Пакет пластин — шт/смену', 'пластин/смену', 'per_unit_shift',
  80, 50, 25, 50,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research', 'PRIMARY: число пластин (packs×plates_in_pack)', 15)
ON CONFLICT (category_code, code) DO UPDATE SET
  calc_kind = EXCLUDED.calc_kind,
  rate_loose = EXCLUDED.rate_loose,
  rate_medium = EXCLUDED.rate_medium,
  rate_hard = EXCLUDED.rate_hard,
  rate_default = EXCLUDED.rate_default,
  notes = EXCLUDED.notes,
  updated_at = NOW();

UPDATE work_norm_rates SET
  notes = COALESCE(notes,'') || ' [не primary: используйте м² / пластины]',
  updated_at = NOW()
WHERE code IN ('compabloc_days','plates_pack_days');

UPDATE work_norm_rates SET
  params_json = jsonb_build_object(
    'by_dn_mh', jsonb_build_object(
      '25', 0.18, '50', 0.22, '100', 0.37, '150', 0.47, '200', 0.55, '300', 1.4, '400', 1.4, '500', 2.2
    ),
    'source', 'ЕНиР Е26-2 ориентир чел·ч/стык Ру1.0'
  ),
  notes = 'PRIMARY сварка: стыки + Ду обязательны',
  updated_at = NOW()
WHERE code = 'weld_joint_shift';

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Изоляция — м² + Ø required
-- ═══════════════════════════════════════════════════════════════════════════
UPDATE work_norm_categories SET
  input_schema_json = '{
    "methods":{
      "insul":{"fields":[
        {"key":"surface_m2","label":"Площадь","unit":"м²"},
        {"key":"diameter_mm","label":"Ø трубы","unit":"мм"},
        {"key":"cover","label":"Покрытие (1 металл / 2 полимер)","unit":"","optional":true},
        {"key":"layers","label":"Слои","unit":"шт","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "insul":{"volume_unit":"м2","derived_metric":"mh_per_m2","fields":[
        {"key":"volume_value","label":"Площадь","unit":"м²","role":"volume"},
        {"key":"diameter_mm","label":"Ø","unit":"мм","role":"diameter"}
      ]}
    }
  }'::jsonb,
  notes = 'м² + Ø трубы обязательны (ЕНиР Е11).',
  updated_at = NOW()
WHERE code = 'insulation';

INSERT INTO work_norm_change_log (entity_type, entity_id, category_code, action, before_json, after_json, comment, user_name)
VALUES (
  'catalog', 'V314', NULL, 'import', NULL,
  '{"rule":"physical volume only","dirs":"tubes,plates,boilers,pipes,itp,repair,insul"}'::jsonb,
  'V314: primary только м²/м³/м/трубки×Ø×L/Ду — не сут/шт',
  'system-rebuild'
);

COMMIT;
