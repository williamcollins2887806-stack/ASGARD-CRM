-- V313: АВО — расчёт и опыт по физ. размерам (м² / трубки×Ø×L), не «сут/секция»
-- Секции разные по размеру; срок от площади или от трубок×диаметр×длины.

BEGIN;

UPDATE work_norm_categories SET
  methods_json = '[
    {"code":"outer","label":"Наружная очистка","primary_rate_code":"avo_m2_shift","derived_metric":"m2_per_shift","volume_unit":"м2"},
    {"code":"tubes","label":"Трубки секции","primary_rate_code":"avo_tubes_min","derived_metric":"min_per_tube","volume_unit":"трубки"}
  ]'::jsonb,
  input_schema_json = '{
    "methods":{
      "outer":{"fields":[
        {"key":"surface_m2","label":"Площадь оребрения / мойки","unit":"м²"},
        {"key":"section_length_m","label":"Длина секции","unit":"м","optional":true},
        {"key":"sections","label":"Число секций (справка)","unit":"секц.","optional":true}
      ]},
      "tubes":{"fields":[
        {"key":"tubes","label":"Трубки всего","unit":"шт"},
        {"key":"diameter_mm","label":"Ø трубки","unit":"мм"},
        {"key":"length_m","label":"Длина трубки","unit":"м"},
        {"key":"section_length_m","label":"Длина секции","unit":"м","optional":true},
        {"key":"sections","label":"Секций (справка)","unit":"секц.","optional":true},
        {"key":"tubes_per_section","label":"Трубок/секц. (если нет «всего»)","unit":"шт","optional":true}
      ]}
    }
  }'::jsonb,
  experience_schema_json = '{
    "methods":{
      "outer":{"volume_unit":"м2","derived_metric":"m2_per_shift","fields":[
        {"key":"volume_value","label":"Площадь","unit":"м²","role":"volume"},
        {"key":"section_length_m","label":"Длина секции","unit":"м","role":"extra","optional":true},
        {"key":"qty","label":"Секций (справка)","unit":"секц.","role":"qty","optional":true}
      ]},
      "tubes":{"volume_unit":"трубки","derived_metric":"min_per_tube","fields":[
        {"key":"volume_value","label":"Трубки всего","unit":"шт","role":"volume"},
        {"key":"diameter_mm","label":"Ø","unit":"мм","role":"diameter"},
        {"key":"length_m","label":"Длина трубки","unit":"м","role":"length"},
        {"key":"section_length_m","label":"Длина секции","unit":"м","role":"extra","optional":true},
        {"key":"qty","label":"Секций (справка)","unit":"секц.","role":"qty","optional":true}
      ]}
    }
  }'::jsonb,
  notes = 'Срок от м² (наружка) или трубки×Ø×L (трубки). «Секция» только справка — размеры разные.',
  updated_at = NOW()
WHERE code = 'avo';

-- Норма мин/труб для АВО (как трубные пучки: Ø-шкала + L/6)
INSERT INTO work_norm_rates (
  category_code, method_code, code, name, unit, calc_kind,
  rate_loose, rate_medium, rate_hard, rate_default,
  crew_json, params_json, basis, notes, sort_order
) VALUES (
  'avo', 'tubes', 'avo_tubes_min', 'АВО трубки — мин/трубка (Ø×L)', 'мин/труб', 'min_per_unit',
  4.5, 6.2, 14.8, 6.2,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb,
  jsonb_build_object(
    'by_diameter', jsonb_build_object(
      '12', 1.5, '16', 1.83, '19', 3.0, '25', 4.0, '32', 5.5, '38', 7.0, '51', 10.0
    ),
    'length_ref_m', 6,
    'formula_note', 'база MODULE/трубные; Ø — шкала; при L≠6м ×(L/6)'
  ),
  'research',
  'Primary для трубок секции АВО. Не сут/секция.',
  35
)
ON CONFLICT (category_code, code) DO UPDATE SET
  calc_kind = EXCLUDED.calc_kind,
  rate_loose = EXCLUDED.rate_loose,
  rate_medium = EXCLUDED.rate_medium,
  rate_hard = EXCLUDED.rate_hard,
  rate_default = EXCLUDED.rate_default,
  params_json = EXCLUDED.params_json,
  notes = EXCLUDED.notes,
  method_code = EXCLUDED.method_code,
  updated_at = NOW();

-- м²-норма — явный primary для наружки
UPDATE work_norm_rates SET
  notes = 'PRIMARY наружная АВО: м²/смену исполнителя (MODULE 55/35/18). Секции — не единица расчёта.',
  sort_order = 5,
  updated_at = NOW()
WHERE code = 'avo_m2_shift';

-- сут/секция оставляются как справочные (не primary)
UPDATE work_norm_rates SET
  notes = COALESCE(notes, '') || ' [не primary: секции разного размера — используйте м² или трубки×Ø×L]',
  updated_at = NOW()
WHERE code IN ('avo_section_days', 'avo_section_tubes');

INSERT INTO work_norm_change_log (entity_type, entity_id, category_code, action, before_json, after_json, comment, user_name)
VALUES (
  'catalog', 'V313', 'avo', 'import', NULL,
  '{"change":"avo primary m2 / min_per_tube physical dims"}'::jsonb,
  'V313 АВО: отказ от сут/секция как primary; м² и трубки×Ø×L',
  'system-rebuild'
);

COMMIT;
