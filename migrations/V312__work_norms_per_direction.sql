-- V312: пересборка Work Norms под каждое направление
-- - experience_schema_json + primary_rate_code / derived_metric в methods_json
-- - обновлённые input_schema по 11 направлениям
-- - calc_kind hours_per_cycle
-- - extras_json у опыта
-- - rates: CIP часы, котлы сут, изоляция by_diameter Е11, weld joints

BEGIN;

-- ─── Schema extensions ──────────────────────────────────────────────────────
ALTER TABLE work_norm_categories
  ADD COLUMN IF NOT EXISTS experience_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE work_norm_experiences
  ADD COLUMN IF NOT EXISTS extras_json JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE work_norm_rates DROP CONSTRAINT IF EXISTS work_norm_rates_calc_kind_check;
ALTER TABLE work_norm_rates
  ADD CONSTRAINT work_norm_rates_calc_kind_check
  CHECK (calc_kind IN (
    'per_unit_shift','days_per_unit','min_per_unit','mh_per_unit',
    'kg_per_m','fixed_days','hours_per_cycle'
  ));

-- ─── Categories: methods + input + experience schemas ─────────────────────────

-- 1. АВО
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"outer","label":"Наружная очистка","primary_rate_code":"avo_section_days","derived_metric":"days_per_section","volume_unit":"секции"},
    {"code":"tubes","label":"Трубки секции","primary_rate_code":"avo_section_tubes","derived_metric":"days_per_section","volume_unit":"секции"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "outer":{"fields":[
        {"key":"sections","label":"Секции","unit":"секц."},
        {"key":"surface_m2","label":"Площадь (опц.)","unit":"м²","optional":true}
      ]},
      "tubes":{"fields":[
        {"key":"sections","label":"Секции","unit":"секц."},
        {"key":"tubes_per_section","label":"Трубок/секц. (опц.)","unit":"шт","optional":true},
        {"key":"diameter_mm","label":"Ø","unit":"мм","optional":true},
        {"key":"length_m","label":"Длина трубки","unit":"м","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "outer":{"volume_unit":"секции","derived_metric":"days_per_section","fields":[
        {"key":"qty","label":"Секции","unit":"секц.","role":"qty"},
        {"key":"surface_m2","label":"Площадь (опц.)","unit":"м²","role":"extra","optional":true}
      ]},
      "tubes":{"volume_unit":"секции","derived_metric":"days_per_section","fields":[
        {"key":"qty","label":"Секции","unit":"секц.","role":"qty"},
        {"key":"diameter_mm","label":"Ø","unit":"мм","role":"diameter","optional":true},
        {"key":"length_m","label":"Длина","unit":"м","role":"length","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'Якорь Апатит: 1.5 сут/секция, смена 1м+3сл; м²-норма — альтернатива',
  updated_at = NOW()
WHERE code = 'avo';

-- 2. Трубные пучки
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
        {"key":"diameter_mm","label":"Ø","unit":"мм","optional":true},
        {"key":"length_m","label":"Длина","unit":"м","optional":true},
        {"key":"bundle_pull","label":"Выемка пучка","type":"checkbox","optional":true},
        {"key":"shell_side","label":"Межтрубное / кожух","type":"checkbox","optional":true}
      ]},
      "gmo":{"fields":[
        {"key":"tubes","label":"Трубки","unit":"шт"},
        {"key":"diameter_mm","label":"Ø","unit":"мм","optional":true}
      ]},
      "chem":{"fields":[
        {"key":"tubes","label":"Трубки","unit":"шт"},
        {"key":"circuit_m3","label":"Объём контура (опц.)","unit":"м³","optional":true},
        {"key":"cycles","label":"Циклы","unit":"шт","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "gdo":{"volume_unit":"трубки","derived_metric":"min_per_tube","fields":[
        {"key":"qty","label":"Аппараты","unit":"шт","role":"qty","optional":true},
        {"key":"volume_value","label":"Трубки (всего или на апп.)","unit":"шт","role":"volume"},
        {"key":"diameter_mm","label":"Ø","unit":"мм","role":"diameter","optional":true},
        {"key":"length_m","label":"Длина","unit":"м","role":"length","optional":true}
      ]},
      "gmo":{"volume_unit":"трубки","derived_metric":"tubes_per_shift","fields":[
        {"key":"qty","label":"Аппараты","unit":"шт","role":"qty","optional":true},
        {"key":"volume_value","label":"Трубки","unit":"шт","role":"volume"},
        {"key":"diameter_mm","label":"Ø","unit":"мм","role":"diameter","optional":true}
      ]},
      "chem":{"volume_unit":"трубки","derived_metric":"mh_per_100_tubes","fields":[
        {"key":"volume_value","label":"Трубки","unit":"шт","role":"volume"},
        {"key":"circuit_m3","label":"Контур","unit":"м³","role":"extra","optional":true},
        {"key":"cycles","label":"Циклы","unit":"шт","role":"extra","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'MODULE 130/95/40 труб/смену; мин/труб с Ø×L; ГЭСН-ориентир хим на 100 труб',
  updated_at = NOW()
WHERE code = 'tubes';

-- 3. Пластинчатые
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"hydro_dis","label":"Разборная ГДО","primary_rate_code":"plates_days_per_app","derived_metric":"days_per_unit","volume_unit":"шт"},
    {"code":"chem_cip","label":"Безразборная химия","primary_rate_code":"plates_cip_hours","derived_metric":"hours_per_cycle","volume_unit":"циклы"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "hydro_dis":{"fields":[
        {"key":"apparatus","label":"Аппараты","unit":"шт"},
        {"key":"plates_count","label":"Пластин (опц.)","unit":"шт","optional":true},
        {"key":"surface_m2","label":"Площадь пластин","unit":"м²","optional":true},
        {"key":"gasket_replace","label":"Замена уплотнений","type":"checkbox","optional":true}
      ]},
      "chem_cip":{"fields":[
        {"key":"apparatus","label":"Аппараты","unit":"шт","optional":true},
        {"key":"circuit_m3","label":"Объём контура","unit":"м³"},
        {"key":"cycles","label":"Циклы","unit":"шт"},
        {"key":"conc_pct","label":"Концентрация","unit":"%","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "hydro_dis":{"volume_unit":"шт","derived_metric":"days_per_unit","fields":[
        {"key":"qty","label":"Аппараты","unit":"шт","role":"qty"},
        {"key":"surface_m2","label":"Площадь (опц.)","unit":"м²","role":"extra","optional":true}
      ]},
      "chem_cip":{"volume_unit":"циклы","derived_metric":"hours_per_cycle","fields":[
        {"key":"cycles","label":"Циклы","unit":"шт","role":"extra"},
        {"key":"hours_fact","label":"Часы факта (все циклы)","unit":"ч","role":"extra"},
        {"key":"circuit_m3","label":"Контур","unit":"м³","role":"extra","optional":true},
        {"key":"qty","label":"Аппараты","unit":"шт","role":"qty","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'Апатит: 3.0 сут на аппарат (разбор+мойка+сбор); CIP — часы/цикл, не м/смену',
  updated_at = NOW()
WHERE code = 'plates';

-- 4. Котлы
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"chem","label":"Химия","primary_rate_code":"boiler_chem_days","derived_metric":"days_per_unit","volume_unit":"шт"},
    {"code":"hydro","label":"Гидро","primary_rate_code":"boiler_hydro_days","derived_metric":"days_per_unit","volume_unit":"шт"},
    {"code":"mech","label":"Механика","primary_rate_code":"boiler_mech_days","derived_metric":"days_per_unit","volume_unit":"шт"},
    {"code":"complex","label":"Комплекс","primary_rate_code":"boiler_complex_days","derived_metric":"days_per_unit","volume_unit":"шт"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "chem":{"fields":[
        {"key":"boilers","label":"Котлы","unit":"шт"},
        {"key":"power_gcal_h","label":"Мощность","unit":"Гкал/ч","optional":true},
        {"key":"circuit_m3","label":"Объём контура","unit":"м³","optional":true},
        {"key":"cycles","label":"Циклы","unit":"шт","optional":true},
        {"key":"acid","label":"Кислотная промывка","type":"checkbox","optional":true}
      ]},
      "hydro":{"fields":[
        {"key":"boilers","label":"Котлы","unit":"шт"},
        {"key":"surface_m2","label":"Площадь нагрева","unit":"м²","optional":true}
      ]},
      "mech":{"fields":[
        {"key":"boilers","label":"Котлы","unit":"шт"},
        {"key":"ozp","label":"ОЗП (внутри)","type":"checkbox","optional":true}
      ]},
      "complex":{"fields":[
        {"key":"boilers","label":"Котлы","unit":"шт"}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "chem":{"volume_unit":"шт","derived_metric":"days_per_unit","fields":[
        {"key":"qty","label":"Котлы","unit":"шт","role":"qty"},
        {"key":"power_gcal_h","label":"Мощность","unit":"Гкал/ч","role":"extra","optional":true},
        {"key":"circuit_m3","label":"Контур","unit":"м³","role":"extra","optional":true}
      ]},
      "hydro":{"volume_unit":"шт","derived_metric":"days_per_unit","fields":[
        {"key":"qty","label":"Котлы","unit":"шт","role":"qty"}
      ]},
      "mech":{"volume_unit":"шт","derived_metric":"days_per_unit","fields":[
        {"key":"qty","label":"Котлы","unit":"шт","role":"qty"}
      ]},
      "complex":{"volume_unit":"шт","derived_metric":"days_per_unit","fields":[
        {"key":"qty","label":"Котлы","unit":"шт","role":"qty"}
      ]}
    }
  }'::jsonb,
  notes = 'Полевой срок — сут/котёл; ГЭСНп 07-04-056 (~700 чел·ч ПНР) — только сверка сметы',
  updated_at = NOW()
WHERE code = 'boilers';

-- 5. Ёмкости
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"clean","label":"Зачистка","primary_rate_code":"vessel_mh_per_m3","derived_metric":"mh_per_m3","volume_unit":"м3"}
  ]'::jsonb,
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
  experience_schema_json = '{
    "methods":{
      "clean":{"volume_unit":"м3","derived_metric":"mh_per_m3","fields":[
        {"key":"volume_value","label":"Объём","unit":"м³","role":"volume"},
        {"key":"deposit_cm","label":"Отложения","unit":"см","role":"extra","optional":true},
        {"key":"product_type","label":"Продукт (1/2/3)","unit":"","role":"extra","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'ОЗП всегда: +наблюдающий (902н R1); ориентир ГЭСНр 67-04',
  updated_at = NOW()
WHERE code = 'vessels';

-- 6. Трубопроводы
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
        {"key":"dn_mm","label":"Ду","unit":"мм","optional":true},
        {"key":"circuit_m3","label":"Объём контура","unit":"м³","optional":true},
        {"key":"cycles","label":"Циклы","unit":"шт","optional":true}
      ]},
      "pickle":{"fields":[
        {"key":"length_m","label":"Длина","unit":"м"},
        {"key":"dn_mm","label":"Ду","unit":"мм"}
      ]},
      "aspo":{"fields":[
        {"key":"length_m","label":"Длина","unit":"м"},
        {"key":"dn_mm","label":"Ду","unit":"мм","optional":true}
      ]},
      "hydro":{"fields":[
        {"key":"length_m","label":"Длина","unit":"м.п."},
        {"key":"dn_mm","label":"Ду","unit":"мм","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "chem_ops":{"volume_unit":"м","derived_metric":"hours_per_cycle","fields":[
        {"key":"length_m","label":"Длина","unit":"м","role":"length","optional":true},
        {"key":"circuit_m3","label":"Контур","unit":"м³","role":"extra","optional":true},
        {"key":"cycles","label":"Циклы","unit":"шт","role":"extra"},
        {"key":"hours_fact","label":"Часы факта","unit":"ч","role":"extra"}
      ]},
      "pickle":{"volume_unit":"м","derived_metric":"kg_per_m","fields":[
        {"key":"length_m","label":"Длина","unit":"м","role":"length"},
        {"key":"dn_mm","label":"Ду","unit":"мм","role":"extra"},
        {"key":"kg_reagent","label":"Реагент факт","unit":"кг","role":"extra"}
      ]},
      "aspo":{"volume_unit":"м","derived_metric":"m_per_shift","fields":[
        {"key":"volume_value","label":"Длина","unit":"м","role":"volume"},
        {"key":"dn_mm","label":"Ду","unit":"мм","role":"extra","optional":true}
      ]},
      "hydro":{"volume_unit":"м","derived_metric":"m_per_shift","fields":[
        {"key":"volume_value","label":"Длина","unit":"м","role":"volume"},
        {"key":"dn_mm","label":"Ду","unit":"мм","role":"extra","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'Протравка: кг/м по Ду + выдержка (fixed_days); хим — контур/циклы если задан circuit',
  updated_at = NOW()
WHERE code = 'pipelines';

-- 7. Химконтуры
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"cip","label":"CIP-контур","primary_rate_code":"cip_hours_circuit","derived_metric":"hours_per_cycle","volume_unit":"циклы"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "cip":{"fields":[
        {"key":"circuit_m3","label":"Объём контура","unit":"м³"},
        {"key":"cycles","label":"Циклы","unit":"шт"},
        {"key":"conc_pct","label":"Концентрация","unit":"%","optional":true},
        {"key":"apparatus_count","label":"Аппаратов в контуре","unit":"шт","optional":true}
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
  notes = 'MODULE ~8 ч/контур, 3 чел; м³ → только реагент, не длительность',
  updated_at = NOW()
WHERE code = 'chem_circuits';

-- 8. Градирни / HVAC
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"tower","label":"Градирня","primary_rate_code":"tower_m2_shift","derived_metric":"m2_per_shift","volume_unit":"м2"},
    {"code":"heating","label":"Отопление / ГВС / хладо","primary_rate_code":"heating_m3_shift","derived_metric":"m3_per_shift","volume_unit":"м3"},
    {"code":"itp","label":"ИТП / ЦТП","primary_rate_code":"itp_days","derived_metric":"days_per_unit","volume_unit":"шт"},
    {"code":"pneumo","label":"Пневмоимпульс","primary_rate_code":"pneumo_m_day","derived_metric":"m_per_shift","volume_unit":"м"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "tower":{"fields":[
        {"key":"surface_m2","label":"Площадь орошения","unit":"м²"},
        {"key":"cells","label":"Секции / ячейки","unit":"шт","optional":true},
        {"key":"biofouling","label":"Биоплёнка (тяжёлые)","type":"checkbox","optional":true}
      ]},
      "heating":{"fields":[
        {"key":"circuit_m3","label":"Объём системы","unit":"м³"},
        {"key":"points","label":"Точки / стояки","unit":"шт","optional":true}
      ]},
      "itp":{"fields":[
        {"key":"objects","label":"ИТП / ЦТП","unit":"шт"},
        {"key":"circuit_m3","label":"Объём","unit":"м³","optional":true}
      ]},
      "pneumo":{"fields":[
        {"key":"length_m","label":"Длина сети","unit":"м"}
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
      "itp":{"volume_unit":"шт","derived_metric":"days_per_unit","fields":[
        {"key":"qty","label":"Объекты ИТП","unit":"шт","role":"qty"}
      ]},
      "pneumo":{"volume_unit":"м","derived_metric":"m_per_shift","fields":[
        {"key":"volume_value","label":"Длина","unit":"м","role":"volume"}
      ]}
    }
  }'::jsonb,
  updated_at = NOW()
WHERE code = 'towers_hvac';

-- 9. Вентиляция / канализация
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"vent","label":"Воздуховоды","primary_rate_code":"vent_lm_shift","derived_metric":"m_per_shift","volume_unit":"м"},
    {"code":"disinfect","label":"Дезинфекция","primary_rate_code":"disinfect_m2","derived_metric":"m2_per_shift","volume_unit":"м2"},
    {"code":"sewer","label":"Канализация / приямки","primary_rate_code":"sewer_m_day","derived_metric":"m_per_shift","volume_unit":"м"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "vent":{"fields":[
        {"key":"length_m","label":"Длина","unit":"м.п."},
        {"key":"surface_m2","label":"Площадь (опц.)","unit":"м²","optional":true},
        {"key":"access_doors","label":"Лючки","unit":"шт","optional":true}
      ]},
      "disinfect":{"fields":[
        {"key":"surface_m2","label":"Площадь","unit":"м²"}
      ]},
      "sewer":{"fields":[
        {"key":"length_m","label":"Длина / точки","unit":"м"},
        {"key":"manholes","label":"Колодцы","unit":"шт","optional":true},
        {"key":"grease","label":"Жировые отложения","type":"checkbox","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "vent":{"volume_unit":"м","derived_metric":"m_per_shift","fields":[
        {"key":"volume_value","label":"Длина","unit":"м","role":"volume"}
      ]},
      "disinfect":{"volume_unit":"м2","derived_metric":"m2_per_shift","fields":[
        {"key":"volume_value","label":"Площадь","unit":"м²","role":"volume"}
      ]},
      "sewer":{"volume_unit":"м","derived_metric":"m_per_shift","fields":[
        {"key":"volume_value","label":"Длина","unit":"м","role":"volume"},
        {"key":"manholes","label":"Колодцы","unit":"шт","role":"extra","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'Primary vent = м.п./смену; высота >5м — coeff height',
  updated_at = NOW()
WHERE code = 'vent_sewer';

-- 10. Ремонт / сварка
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"compabloc","label":"Компаблок","primary_rate_code":"compabloc_days","derived_metric":"days_per_unit","volume_unit":"шт"},
    {"code":"plates_pack","label":"Пакет пластин","primary_rate_code":"plates_pack_days","derived_metric":"days_per_unit","volume_unit":"шт"},
    {"code":"weld","label":"Сварка","primary_rate_code":"weld_joint_shift","derived_metric":"joints_per_shift","volume_unit":"стык"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "compabloc":{"fields":[
        {"key":"qty","label":"Кол-во","unit":"шт"},
        {"key":"plates_count","label":"Пластин","unit":"шт","optional":true}
      ]},
      "plates_pack":{"fields":[
        {"key":"qty","label":"Пакеты","unit":"шт"},
        {"key":"plates_in_pack","label":"Пластин в пакете","unit":"шт","optional":true}
      ]},
      "weld":{"fields":[
        {"key":"joints","label":"Стыки","unit":"шт"},
        {"key":"length_m","label":"Длина шва (опц.)","unit":"м","optional":true},
        {"key":"dn_mm","label":"Ду","unit":"мм","optional":true},
        {"key":"ru","label":"Ру","unit":"МПа","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "compabloc":{"volume_unit":"шт","derived_metric":"days_per_unit","fields":[
        {"key":"qty","label":"Шт","unit":"шт","role":"qty"}
      ]},
      "plates_pack":{"volume_unit":"шт","derived_metric":"days_per_unit","fields":[
        {"key":"qty","label":"Пакеты","unit":"шт","role":"qty"}
      ]},
      "weld":{"volume_unit":"стык","derived_metric":"joints_per_shift","fields":[
        {"key":"volume_value","label":"Стыки","unit":"шт","role":"volume"},
        {"key":"dn_mm","label":"Ду","unit":"мм","role":"extra","optional":true}
      ]}
    }
  }'::jsonb,
  updated_at = NOW()
WHERE code = 'repair_weld';

-- 11. Изоляция
UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"insul","label":"Изоляция","primary_rate_code":"insul_mh_m2","derived_metric":"mh_per_m2","volume_unit":"м2"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "insul":{"fields":[
        {"key":"surface_m2","label":"Площадь","unit":"м²"},
        {"key":"diameter_mm","label":"Ø трубы","unit":"мм","optional":true},
        {"key":"cover","label":"Покрытие (1 металл / 2 полимер)","unit":"","optional":true},
        {"key":"layers","label":"Слои","unit":"шт","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "insul":{"volume_unit":"м2","derived_metric":"mh_per_m2","fields":[
        {"key":"volume_value","label":"Площадь","unit":"м²","role":"volume"},
        {"key":"diameter_mm","label":"Ø","unit":"мм","role":"diameter","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'ЕНиР Е11 чел·ч/м² по Ø — в params.by_diameter',
  updated_at = NOW()
WHERE code = 'insulation';

-- ─── Rates updates / inserts ────────────────────────────────────────────────

-- Plates CIP → hours_per_cycle (MODULE 8 ч)
UPDATE work_norm_rates SET
  calc_kind = 'hours_per_cycle',
  unit = 'ч/цикл',
  rate_loose = 4,
  rate_medium = 6,
  rate_hard = 8,
  rate_default = 6,
  notes = 'Отрасль CIP 2–6 ч; MODULE 8 ч потолок; не масштабировать м³',
  basis = 'research',
  updated_at = NOW()
WHERE code = 'plates_cip_hours';

-- CIP circuits
UPDATE work_norm_rates SET
  calc_kind = 'hours_per_cycle',
  unit = 'ч/цикл',
  rate_loose = 6,
  rate_medium = 8,
  rate_hard = 12,
  rate_default = 8,
  notes = 'MODULE 8 ч/контур, 3 чел; м³ → реагент',
  basis = 'expert',
  updated_at = NOW()
WHERE code = 'cip_hours_circuit';

-- Pipe chem circuit hours
UPDATE work_norm_rates SET
  calc_kind = 'hours_per_cycle',
  unit = 'ч/цикл',
  notes = COALESCE(notes,'') || '; primary при заданном circuit_m3/cycles',
  updated_at = NOW()
WHERE code = 'pipe_chem_circuit_hours';

-- Протравка: шкалу Ду на primary rate
UPDATE work_norm_rates SET
  params_json = COALESCE(
    (SELECT params_json FROM work_norm_rates WHERE code = 'pipe_pickle_by_dn' LIMIT 1),
    '{"by_dn":{"25":0.07,"32":0.09,"40":0.11,"50":0.14,"65":0.18,"80":0.22,"100":0.28,"150":0.42,"200":0.55}}'::jsonb
  ),
  notes = COALESCE(notes,'') || '; by_dn шкала на primary',
  updated_at = NOW()
WHERE code = 'pipe_pickle_kg_m';

-- Boiler chem: field days (not GESNp man-hours as primary)
INSERT INTO work_norm_rates (
  category_code, method_code, code, name, unit, calc_kind,
  rate_loose, rate_medium, rate_hard, rate_default,
  crew_json, params_json, basis, notes, sort_order
) VALUES
('boilers', 'chem', 'boiler_chem_days', 'Химочистка котла — сут (поле)', 'сут/котёл', 'days_per_unit',
  3, 5, 8, 5,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb,
  '{"gesnp_note":"ГЭСНп 07-04-056 ~693–795 чел·ч ПНР — сверка сметы, не полевая бригада; кислота ×1.6"}'::jsonb,
  'research', 'Полевой срок Асгарда; acid checkbox → ×1.15 к суткам', 5)
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
  notes = 'ГЭСНп-ориентир ПНР (не слесари Асгарда); primary = boiler_chem_days',
  updated_at = NOW()
WHERE code = 'boiler_chem_mh';

-- Insulation ЕНиР E11-2 by diameter (man_hours/m2)
UPDATE work_norm_rates SET
  params_json = jsonb_build_object(
    'by_diameter', jsonb_build_object(
      '108', 0.38, '159', 0.29, '273', 0.24, '426', 0.21, '820', 0.18, '1220', 0.15
    ),
    'cover_metal_mult', 1.55,
    'cover_polymer_mult', 0.76,
    'source', 'ЕНиР Е11-2/Е11-3 ориентир'
  ),
  notes = 'ЕНиР Е11 чел·ч/м² по Ø; cover 1=металл ×1.55, 2=полимер ×0.76 к базе матов',
  basis = 'enir',
  updated_at = NOW()
WHERE code = 'insul_mh_m2';

-- Ensure weld_joint_shift is primary-ready
UPDATE work_norm_rates SET
  rate_loose = COALESCE(rate_loose, 6),
  rate_medium = COALESCE(rate_medium, 4),
  rate_hard = COALESCE(rate_hard, 2),
  rate_default = COALESCE(rate_default, 4),
  notes = COALESCE(notes, 'стык/смену; огневые +наблюдающий R5'),
  updated_at = NOW()
WHERE code = 'weld_joint_shift';

-- Vessel: mark ozp in crew
UPDATE work_norm_rates SET
  crew_json = jsonb_set(
    COALESCE(crew_json, '{}'::jsonb),
    '{observer_rule}',
    '"1:1"'
  ),
  updated_at = NOW()
WHERE code IN ('vessel_mh_per_m3', 'vessel_days_per_100m3');

-- Audit
INSERT INTO work_norm_change_log (entity_type, entity_id, category_code, action, before_json, after_json, comment, user_name)
VALUES (
  'catalog', 'V312', NULL, 'import', NULL,
  '{"source":"work-norms rebuild","items":"experience_schema,primary_rate,hours_per_cycle,boiler_boiler_days"}'::jsonb,
  'V312 пересборка: schemas по 11 направлениям, hours_per_cycle, primary_rate_code',
  'system-rebuild'
);

COMMIT;
