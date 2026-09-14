-- V311: обогащение справочника норм по открытым источникам + формулы MODULE/опыт
-- Источники (ориентиры, не ГОСТ-истина):
--   MODULE §3.5: 130/95/40 труб/смену (лёгкие/средние/тяжёлые)
--   Апатит field: Ø16≈1.83 мин, Ø19≈3.0 мин; АВО 1.5 сут/секц.
--   Industry (Boshiya/AfricaTuff): manual 3–8 труб/ч; semi 8–15; auto 20–40 труб/ч
--   Пересчёт мин/труб из труб/смену: min = (shift_h * 60 * k_irv) / tubes_per_shift
--     при 12ч и КИРВ 0.82 → 590.4 / N: 130→4.5; 95→6.2; 40→14.8 мин (бригада 1 пост)
--   ГЭСНр 65-22 (прочистка ребристых), отраслевые ТК АВО (НТЦ Оптимо) — качественные якоря
-- basis='research' для новых; существующие field/gesn не затираем без нужды.

BEGIN;

-- 1) ГДО мин/труб — params по диаметру + калировка базы к формуле MODULE
UPDATE work_norm_rates SET
  rate_loose = 4.5,
  rate_medium = 6.2,
  rate_hard = 14.8,
  rate_default = 6.2,
  params_json = jsonb_build_object(
    'by_diameter', jsonb_build_object(
      '12', 1.5,
      '16', 1.83,
      '19', 3.0,
      '25', 4.0,
      '32', 5.5,
      '38', 7.0,
      '51', 10.0
    ),
    'length_ref_m', 6,
    'formula_note', 'база = (12ч×60×0.82)/труб_смену MODULE; Ø — калибровка Апатит+отрасль; при L≠6м ×(L/6)'
  ),
  notes = 'MODULE 130/95/40→мин; Ø16/19 Апатит; industry manual~7–20 мин/труб (тяжёлые). Пересчёт при L: ×(L/6)',
  basis = 'research',
  updated_at = NOW()
WHERE code = 'tubes_min_per_tube';

-- 2) ГДО труб/смену — params by_diameter → труб/смену (обратная калировка)
UPDATE work_norm_rates SET
  params_json = jsonb_build_object(
    'by_diameter', jsonb_build_object(
      '16', 150,
      '19', 120,
      '25', 95,
      '32', 70,
      '38', 55,
      '51', 40
    ),
    'fouling_mult', jsonb_build_object('light', 1.35, 'medium', 1.0, 'heavy', 0.42)
  ),
  notes = COALESCE(notes, '') || '; by_diameter research 2026-07 (MODULE+industry)',
  updated_at = NOW()
WHERE code = 'tubes_per_shift_gdo';

-- 3) ГМО — чуть ниже ГДО
UPDATE work_norm_rates SET
  rate_loose = COALESCE(rate_loose, 100),
  rate_medium = COALESCE(rate_medium, 70),
  rate_hard = COALESCE(rate_hard, 30),
  rate_default = COALESCE(rate_default, 70),
  params_json = jsonb_build_object(
    'by_diameter', jsonb_build_object('16', 110, '19', 90, '25', 70, '32', 50, '38', 40)
  ),
  notes = COALESCE(notes, '') || '; GMO ≈ 0.75×GDO при том же fouling',
  updated_at = NOW()
WHERE code = 'tubes_per_shift_gmo';

-- 4) АВО — м² и секции: уточнение notes + shell-side
UPDATE work_norm_rates SET
  notes = 'Апатит #1961: 1.5 сут/секц наружная, 1м+3сл; ГЭСНм-ориентир 15-08; при тяжёлом оребрении ×1.3',
  updated_at = NOW()
WHERE code = 'avo_section_days';

-- 5) Пластинчатые — площадьная норма
INSERT INTO work_norm_rates (
  category_code, method_code, code, name, unit, calc_kind,
  rate_loose, rate_medium, rate_hard, rate_default,
  crew_json, params_json, basis, notes, sort_order
) VALUES
('plates', 'hydro_dis', 'plates_m2_shift', 'Пластинчатый — м² пластин/смену (мойка)', 'м²/смену', 'per_unit_shift',
  80, 50, 25, 50,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb,
  '{"includes":"разбор+мойка+осмотр; сбор отдельно ~0.5–1 сут"}'::jsonb,
  'research', 'Industry CIP/plate wash ориентир; при компаблоке −30%', 15),
('tubes', 'gdo', 'tubes_shell_days', 'Межтрубное / кожух — сут на аппарат', 'сут/апп.', 'days_per_unit',
  1.0, 1.5, 2.5, 1.5,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research', 'Наружная/межтрубная мойка ВД; зависит от доступа и fouling', 50),
('tubes', 'gdo', 'tubes_bundle_pull_days', 'Выемка/задвижка пучка — сут', 'сут/апп.', 'days_per_unit',
  0.5, 1.0, 2.0, 1.0,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb,
  '{"crane":true}'::jsonb,
  'research', 'Такелаж+подготовка; не включать в мин/труб', 55),
('boilers', 'complex', 'boiler_complex_days', 'Комплексная очистка котла — сут', 'сут/котёл', 'days_per_unit',
  5, 8, 14, 8,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research', 'Химия+гидро+механика; ГЭСНр 69-12 ориентир трудоёмкости', 40),
('vessels', 'clean', 'vessel_days_per_100m3', 'Зачистка ёмкости — сут на 100 м³', 'сут/100м³', 'days_per_unit',
  1.5, 2.5, 4.0, 2.5,
  '{"master":2,"exec":6,"observer_rule":"1:1"}'::jsonb,
  '{"ozp":true}'::jsonb,
  'research', 'От ГЭСНр-ориентира ~0.25 чел·ч/м³ → при бригаде 8 чел·смен ≈2.5 сут/100м³', 20),
('pipelines', 'pickle', 'pipe_pickle_by_dn', 'Протравка — кг кислоты / м (шкала Ду)', 'кг/м', 'kg_per_m',
  NULL, 0.14, NULL, 0.14,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb,
  '{"by_dn":{"25":0.07,"32":0.09,"40":0.11,"50":0.14,"65":0.18,"80":0.22,"100":0.28,"150":0.42,"200":0.55}}'::jsonb,
  'research', 'СНиП/отрасль ориентир; база Ду50=0.14 кг/м', 22),
('pipelines', 'chem_ops', 'pipe_chem_circuit_hours', 'Химпромывка контура — ч', 'ч/контур', 'mh_per_unit',
  6, 10, 16, 10,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb,
  '{"cycles_default":3}'::jsonb,
  'research', 'Циркуляция+выдержка+промывка; +время на набор/слив', 15),
('towers_hvac', 'tower', 'tower_fill_m2_shift', 'Градирня (заполнитель) — м²/смену', 'м²/смену', 'per_unit_shift',
  35, 22, 12, 22,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research', 'Гидро+механика оросителя; биоплёнка = hard', 15),
('vent_sewer', 'vent', 'vent_lm_shift', 'Воздуховоды — м.п./смену', 'м.п./смену', 'per_unit_shift',
  40, 25, 12, 25,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research', 'Щётки/ВД; высота >5м ×1.15 (coeff height)', 15),
('repair_weld', 'weld', 'weld_joint_shift', 'Сварка стыков ТО — стык/смену', 'стык/смену', 'per_unit_shift',
  6, 4, 2, 4,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research', 'Ориентир аргон/полуавтомат на трубе; контроль шва отдельно', 35),
('insulation', 'insul', 'insul_m2_shift', 'Изоляция — м²/смену бригады', 'м²/смену', 'per_unit_shift',
  25, 18, 10, 18,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb,
  '{}'::jsonb,
  'research', 'ЕНиР-ориентир; при 0.6 чел·ч/м² и 3 сл×12ч×0.82 ≈ ~49 чел·ч → ~18 м²/смену бригады', 20)
ON CONFLICT (category_code, code) DO UPDATE SET
  rate_loose = EXCLUDED.rate_loose,
  rate_medium = EXCLUDED.rate_medium,
  rate_hard = EXCLUDED.rate_hard,
  rate_default = EXCLUDED.rate_default,
  params_json = EXCLUDED.params_json,
  notes = EXCLUDED.notes,
  basis = EXCLUDED.basis,
  updated_at = NOW();

-- 6) Дозаполнить пустые rate у уже существующих
UPDATE work_norm_rates SET
  rate_loose = COALESCE(rate_loose, 60),
  rate_medium = COALESCE(rate_medium, 50),
  rate_hard = COALESCE(rate_hard, 30),
  rate_default = COALESCE(rate_default, 50),
  notes = COALESCE(notes, '') || '; filled research 2026-07',
  updated_at = NOW()
WHERE code = 'vent_m2_shift' AND (rate_default IS NULL OR rate_medium IS NULL);

UPDATE work_norm_rates SET
  rate_loose = COALESCE(rate_loose, 100),
  rate_medium = COALESCE(rate_medium, 80),
  rate_hard = COALESCE(rate_hard, 50),
  rate_default = COALESCE(rate_default, 80),
  updated_at = NOW()
WHERE code = 'disinfect_m2' AND rate_default IS NULL;

UPDATE work_norm_rates SET
  rate_loose = COALESCE(rate_loose, 40),
  rate_medium = COALESCE(rate_medium, 30),
  rate_hard = COALESCE(rate_hard, 15),
  rate_default = COALESCE(rate_default, 30),
  updated_at = NOW()
WHERE code = 'sewer_m_day' AND rate_default IS NULL;

UPDATE work_norm_rates SET
  rate_loose = COALESCE(rate_loose, 1.5),
  rate_medium = COALESCE(rate_medium, 2),
  rate_hard = COALESCE(rate_hard, 3.5),
  rate_default = COALESCE(rate_default, 2),
  updated_at = NOW()
WHERE code = 'compabloc_days' AND (rate_loose IS NULL);

UPDATE work_norm_rates SET
  rate_loose = COALESCE(rate_loose, 1.0),
  rate_medium = COALESCE(rate_medium, 1.5),
  rate_hard = COALESCE(rate_hard, 2.5),
  rate_default = COALESCE(rate_default, 1.5),
  updated_at = NOW()
WHERE code = 'plates_pack_days' AND rate_loose IS NULL;

UPDATE work_norm_rates SET
  rate_loose = COALESCE(rate_loose, 10),
  rate_medium = COALESCE(rate_medium, 8),
  rate_hard = COALESCE(rate_hard, 4),
  rate_default = COALESCE(rate_default, 8),
  updated_at = NOW()
WHERE code = 'weld_m_shift' AND rate_loose IS NULL;

-- 7) Химия — актуальные ориентиры рынка РФ 2025–26 (₽/кг, грубо)
UPDATE work_norm_chemistry SET price_kg = 195, notes = COALESCE(notes,'') || '; прайс research 2026-07', updated_at = NOW()
WHERE code = 'acid_isk' AND (price_kg IS NULL OR price_kg < 100);
UPDATE work_norm_chemistry SET price_kg = 240, updated_at = NOW() WHERE code = 'alkali_sh';
UPDATE work_norm_chemistry SET price_kg = 380, updated_at = NOW() WHERE code = 'solvent';
UPDATE work_norm_chemistry SET price_kg = 420, updated_at = NOW() WHERE code = 'passivator';
UPDATE work_norm_chemistry SET price_kg = 165, updated_at = NOW() WHERE code = 'ortho';
UPDATE work_norm_chemistry SET price_kg = 135, updated_at = NOW() WHERE code = 'hydro_acid';
UPDATE work_norm_chemistry SET price_kg = 95, updated_at = NOW() WHERE code = 'soda';

INSERT INTO work_norm_chemistry (code, name, price_kg, kg_per_m2, kg_per_m3, deposit_type, category_codes, notes) VALUES
('citric', 'Лимонная кислота (пищ./тех.)', 110, 0.4, 2.5, 'scale', ARRAY['plates','chem_circuits','boilers'], 'CIP soft scale'),
('sulfamic', 'Сульфаминовая кислота', 200, 0.5, 3.0, 'scale', ARRAY['boilers','pipelines','plates'], 'Котлы/ТО без сильной коррозии'),
('inhibitor', 'Ингибитор коррозии (универсал)', 450, 0.05, 0.3, 'finish', ARRAY['pipelines','chem_circuits','boilers'], 'В комплексе с кислотой')
ON CONFLICT (code) DO UPDATE SET
  price_kg = EXCLUDED.price_kg,
  kg_per_m2 = EXCLUDED.kg_per_m2,
  kg_per_m3 = EXCLUDED.kg_per_m3,
  notes = EXCLUDED.notes,
  updated_at = NOW();

-- 8) Оборудование — доп. позиции
INSERT INTO work_norm_equipment (category_code, code, name, qty_formula, stub_price_rub, capex_in_cost_pct, purpose, notes) VALUES
('tubes', 'vulcan', 'Установка пневмоимпульс / Вулкан', '1', 2500000, 30, 'тяжёлые/бетонные отложения', 'Апатит field'),
('tubes', 'flex_lance_set', 'Комплект гибких копий (пост)', 'posts', 180000, NULL, 'ГДО трубок', 'industry'),
('avo', 'scaffold_avo', 'Леса / подмости под секцию АВО', 'ceil(sections/4)', 120000, NULL, 'наружная мойка', NULL),
('plates', 'torque_wrench', 'Динамометрический ключ / стяжка пакета', '1', 80000, NULL, 'сборка пластинчатого', NULL),
('vessels', 'scba', 'ДАСВ / воздушный аппарат', 'observers', 150000, NULL, 'ОЗП', '1:1 наблюдающий'),
('towers_hvac', 'hp_washer_tower', 'Мойка ВД для градирни', '1', 600000, 25, 'ороситель', NULL)
ON CONFLICT (category_code, code) DO NOTHING;

-- 9) Аудит
INSERT INTO work_norm_change_log (entity_type, entity_id, category_code, action, before_json, after_json, comment, user_name)
VALUES (
  'catalog', 'V311', NULL, 'import', NULL,
  '{"source":"research 2026-07","items":"by_diameter,plates_m2,shell,pickle_dn,chem,equipment"}'::jsonb,
  'V311 обогащение справочника: MODULE↔мин/труб, Ø-шкала, industry tubes/h, химия, оборудование',
  'system-research'
);

COMMIT;
