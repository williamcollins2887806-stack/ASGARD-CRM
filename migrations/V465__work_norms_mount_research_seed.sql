-- V465: категория mount, расширение repair_weld / insulation, research_seed нормы
-- Ориентиры ГЭСНр/ГЭСНм/ЕНиР — только в notes, не юридическая привязка.

BEGIN;

-- ─── 1. Монтаж / такелаж ───────────────────────────────────────────────────
INSERT INTO work_norm_categories (code, title, sort_order, methods_json, input_schema_json, experience_schema_json, notes)
VALUES (
  'mount', 'Монтаж и такелаж ТО', 95,
  '[
    {"code":"mount","label":"Монтаж","primary_rate_code":"mount_to_shift","derived_metric":"units_per_shift","volume_unit":"шт"},
    {"code":"dismount","label":"Демонтаж","primary_rate_code":"dismount_to_shift","derived_metric":"units_per_shift","volume_unit":"шт"},
    {"code":"rigging","label":"Такелаж","primary_rate_code":"rigging_lift_shift","derived_metric":"lifts_per_shift","volume_unit":"операция"},
    {"code":"flange","label":"Фланцы / прокладки","primary_rate_code":"flange_joint_shift","derived_metric":"joints_per_shift","volume_unit":"стык"}
  ]'::jsonb,
  '{
    "methods":{
      "mount":{"fields":[
        {"key":"qty","label":"Аппаратов / узлов","unit":"шт"},
        {"key":"mass_t","label":"Масса, т","unit":"т","optional":true},
        {"key":"height_m","label":"Высота, м","unit":"м","optional":true}
      ]},
      "dismount":{"fields":[
        {"key":"qty","label":"Аппаратов / узлов","unit":"шт"},
        {"key":"mass_t","label":"Масса, т","unit":"т","optional":true}
      ]},
      "rigging":{"fields":[
        {"key":"lifts","label":"Подъёмов / перестановок","unit":"шт"},
        {"key":"mass_t","label":"Масса груза, т","unit":"т","optional":true}
      ]},
      "flange":{"fields":[
        {"key":"joints","label":"Стыков / фланцев","unit":"шт"},
        {"key":"dn_mm","label":"Ду","unit":"мм","optional":true}
      ]}
    }
  }'::jsonb,
  '{
    "methods":{
      "mount":{"volume_unit":"шт","derived_metric":"units_per_shift","fields":[{"key":"qty","label":"Шт","unit":"шт","role":"volume"}]},
      "dismount":{"volume_unit":"шт","derived_metric":"units_per_shift","fields":[{"key":"qty","label":"Шт","unit":"шт","role":"volume"}]},
      "rigging":{"volume_unit":"операция","derived_metric":"lifts_per_shift","fields":[{"key":"lifts","label":"Операций","unit":"шт","role":"volume"}]},
      "flange":{"volume_unit":"стык","derived_metric":"joints_per_shift","fields":[{"key":"joints","label":"Стыки","unit":"шт","role":"volume"}]}
    }
  }'::jsonb,
  'Монтаж/демонтаж ТО; такелаж отдельно от ГДО'
)
ON CONFLICT (code) DO UPDATE SET
  title = EXCLUDED.title,
  sort_order = EXCLUDED.sort_order,
  methods_json = EXCLUDED.methods_json,
  input_schema_json = EXCLUDED.input_schema_json,
  experience_schema_json = EXCLUDED.experience_schema_json,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- ─── 2. repair_weld: резка, огневые ───────────────────────────────────────
UPDATE work_norm_categories SET
  methods_json = COALESCE(methods_json, '[]'::jsonb) ||
    '[
      {"code":"cutting","label":"Резка / демонтаж металла","primary_rate_code":"cutting_m_shift","derived_metric":"m_per_shift","volume_unit":"м"},
      {"code":"fire_works","label":"Огневые работы","primary_rate_code":"fire_works_shift","derived_metric":"points_per_shift","volume_unit":"точка"}
    ]'::jsonb,
  input_schema_json = COALESCE(input_schema_json, '{}'::jsonb) ||
    '{
      "methods":{
        "cutting":{"fields":[
          {"key":"length_m","label":"Длина реза","unit":"м"},
          {"key":"thickness_mm","label":"Толщина","unit":"мм","optional":true}
        ]},
        "fire_works":{"fields":[
          {"key":"points","label":"Точек / стыков огневых","unit":"шт"},
          {"key":"ozp","label":"ОЗП (наблюдающий)","unit":"","optional":true}
        ]}
      }
    }'::jsonb,
  experience_schema_json = COALESCE(experience_schema_json, '{}'::jsonb) ||
    '{
      "methods":{
        "cutting":{"volume_unit":"м","derived_metric":"m_per_shift","fields":[{"key":"length_m","label":"М","unit":"м","role":"volume"}]},
        "fire_works":{"volume_unit":"точка","derived_metric":"points_per_shift","fields":[{"key":"points","label":"Точки","unit":"шт","role":"volume"}]}
      }
    }'::jsonb,
  updated_at = NOW()
WHERE code = 'repair_weld'
  AND NOT (methods_json::text LIKE '%"cutting"%');

-- ─── 3. insulation: шкала Ø (Е11) ─────────────────────────────────────────
UPDATE work_norm_rates SET
  params_json = COALESCE(params_json, '{}'::jsonb) || jsonb_build_object(
    'by_diameter', jsonb_build_object(
      '57', 0.35,
      '89', 0.42,
      '108', 0.48,
      '133', 0.55,
      '159', 0.62,
      '219', 0.72,
      '273', 0.85,
      '325', 0.95,
      '426', 1.15,
      '530', 1.35
    ),
    'cover_metal_mult', 1.15,
    'cover_polymer_mult', 1.0,
    'source', 'ЕНиР Е11 ориентир чел·ч/м² по Ø трубы'
  ),
  notes = COALESCE(notes, '') || '; V465: by_diameter Е11 (research_seed orientir)',
  updated_at = NOW()
WHERE code = 'insul_mh_m2'
  AND (params_json->'by_diameter' IS NULL OR params_json->'by_diameter' = '{}'::jsonb);

-- ─── 4. pipelines: опрессовка (hydrotest) ─────────────────────────────────
UPDATE work_norm_categories SET
  methods_json = COALESCE(methods_json, '[]'::jsonb) ||
    '[{"code":"hydrotest","label":"Опрессовка","primary_rate_code":"pipe_hydrotest_hours","derived_metric":"hours_per_cycle","volume_unit":"контур"}]'::jsonb,
  input_schema_json = COALESCE(input_schema_json, '{}'::jsonb) ||
    '{"methods":{"hydrotest":{"fields":[
      {"key":"length_m","label":"Длина контура","unit":"м"},
      {"key":"dn_mm","label":"Ду","unit":"мм","optional":true},
      {"key":"test_pressure_mpa","label":"P испытания","unit":"МПа","optional":true}
    ]}}}'::jsonb,
  updated_at = NOW()
WHERE code = 'pipelines'
  AND NOT (methods_json::text LIKE '%"hydrotest"%');

-- ─── 5. research_seed rates ────────────────────────────────────────────────
INSERT INTO work_norm_rates (
  category_code, method_code, code, name, unit, calc_kind,
  rate_loose, rate_medium, rate_hard, rate_default,
  crew_json, params_json, basis, notes, sort_order
) VALUES
('mount', 'mount', 'mount_to_shift', 'Монтаж ТО — аппарат/смену бригады', 'шт/смену', 'per_unit_shift',
  0.8, 0.5, 0.25, 0.5,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb,
  '{"height_mult_above_5m":1.12}'::jsonb,
  'research_seed', 'Ориентир ГЭСНр монтаж ТО; масса/высота уточняют на объекте', 10),
('mount', 'dismount', 'dismount_to_shift', 'Демонтаж ТО — аппарат/смену', 'шт/смену', 'per_unit_shift',
  1.0, 0.65, 0.35, 0.65,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research_seed', 'Демонтаж ≈ 1.2× монтаж по отраслевым ТК', 20),
('mount', 'rigging', 'rigging_lift_shift', 'Такелаж — подъём/смену', 'опер/смену', 'per_unit_shift',
  3, 2, 1, 2,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb,
  '{"crane":true}'::jsonb,
  'research_seed', 'Кран + стропальщики; не включать в мин/труб', 30),
('mount', 'flange', 'flange_joint_shift', 'Фланец / прокладка — стык/смену', 'стык/смену', 'per_unit_shift',
  5, 3, 1.5, 3,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research_seed', 'Замена прокладки + подтяжка; контроль — отдельно', 40),
('repair_weld', 'cutting', 'cutting_m_shift', 'Резка металла — м/смену', 'м/смену', 'per_unit_shift',
  12, 8, 4, 8,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research_seed', 'ГЭСНр-ориентир резка листа/трубы; толщина >12мм → hard', 45),
('repair_weld', 'fire_works', 'fire_works_shift', 'Огневые — точка/смену', 'точка/смену', 'per_unit_shift',
  4, 2.5, 1, 2.5,
  '{"master":1,"exec":2,"observer_rule":"1:1"}'::jsonb,
  '{}'::jsonb,
  'research_seed', 'ОЗП: observer 1:1; наряд-допуск не в норме', 50),
('boilers', 'mech', 'boiler_to_m2_shift', 'Котёл/ТО — м²/смену (Часть 14 ориентир)', 'м²/смену', 'per_unit_shift',
  45, 28, 14, 28,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb,
  '{"part":"14","note":"поверхность нагрева"}'::jsonb,
  'research_seed', 'ГЭСНр Часть 14 ориентир м²/смену; не путать с сут/котёл', 25),
('pipelines', 'hydro', 'pipe_gdo_by_dn_shift', 'ГДО трубопровода — м/смену по Ду', 'м/смену', 'per_unit_shift',
  70, 45, 22, 45,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb,
  '{"by_dn":{"50":55,"80":45,"100":38,"150":28,"200":22,"250":18,"300":14,"400":10,"500":8}}'::jsonb,
  'research_seed', 'ГЭСНр 66-01-047 ориентир м/смену бригады по Ду; Ø/отложения уточняют', 12),
('pipelines', 'pickle', 'pipe_pickle_mh_dn', 'Протравка — чел·ч/м по Ду', 'чел·ч/м', 'mh_per_unit',
  NULL, 0.55, NULL, 0.55,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb,
  '{"by_dn":{"25":0.25,"50":0.35,"80":0.45,"100":0.55,"150":0.75,"200":0.95,"300":1.25}}'::jsonb,
  'research_seed', 'ГЭСНм 12-11-004 ориентир (протравка); НЕ ГЭСНм-18 (уборка)', 23),
('tubes', 'gdo', 'tubes_drill_pcs_shift', 'Сверление труб — шт/смену', 'труб/смену', 'per_unit_shift',
  25, 15, 6, 15,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb,
  '{"by_diameter":{"16":22,"19":18,"25":14,"32":10}}'::jsonb,
  'research_seed', 'Отдельная операция от ГДО; Ø калибрует выработку', 45),
('pipelines', 'hydrotest', 'pipe_hydrotest_hours', 'Опрессовка — ч/контур', 'ч/контур', 'hours_per_cycle',
  4, 6, 10, 6,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb,
  '{"cycles_default":1}'::jsonb,
  'research_seed', 'Набор/выдержка/слив; P испытания в inputs', 28),
('vent_sewer', 'vent', 'vent_tower_lm_shift', 'Воздуховоды/башни — м.п./смену (диапазон)', 'м.п./смену', 'per_unit_shift',
  35, 22, 10, 22,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb,
  '{"height_bands_m":{"5":1.0,"10":0.82,"20":0.65,"40":0.45},"expert_range":"12–35 м.п./смену"}'::jsonb,
  'research_seed', 'Экспертный диапазон; высота >5м ×coeff height', 18),
('towers_hvac', 'tower', 'tower_fill_m2_shift_expert', 'Градирня — м²/смену (эксперт)', 'м²/смену', 'per_unit_shift',
  40, 25, 12, 25,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb,
  '{"expert_range":"15–30 м²/смену","biofilm_hard_mult":0.55}'::jsonb,
  'research_seed', 'Дублирует tower_fill_m2_shift с явным expert_range для калибровки', 16)
ON CONFLICT (category_code, code) DO NOTHING;

INSERT INTO work_norm_change_log (entity_type, entity_id, category_code, action, before_json, after_json, comment, user_name)
SELECT 'catalog', 'V465', NULL, 'import', NULL,
  jsonb_build_object(
    'mount', true,
    'repair_weld_methods', jsonb_build_array('cutting', 'fire_works'),
    'insulation_by_diameter', true,
    'hydrotest', true,
    'rates_inserted', (
      SELECT COUNT(*) FROM work_norm_rates
      WHERE basis = 'research_seed' AND notes LIKE '%V465%' OR code IN (
        'mount_to_shift','dismount_to_shift','rigging_lift_shift','flange_joint_shift',
        'cutting_m_shift','fire_works_shift','boiler_to_m2_shift','pipe_gdo_by_dn_shift',
        'pipe_pickle_mh_dn','tubes_drill_pcs_shift','pipe_hydrotest_hours',
        'vent_tower_lm_shift','tower_fill_m2_shift_expert'
      )
    )
  ),
  'V465: mount + research_seed нормы (ориентиры ГЭСН/ЕНиР в notes)',
  'system-migration'
WHERE NOT EXISTS (
  SELECT 1 FROM work_norm_change_log
  WHERE entity_type = 'catalog' AND entity_id = 'V465' AND action = 'import'
);

COMMIT;
