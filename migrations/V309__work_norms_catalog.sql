-- V309: Справочник норм Асгарда (выработка, химия, оборудование, globals, audit)
-- Источник для мини-калькулятора РП (математика) и для Мимира (read-only).

CREATE TABLE IF NOT EXISTS work_norm_globals (
  key          TEXT PRIMARY KEY,
  value_num    NUMERIC,
  value_text   TEXT,
  label        TEXT NOT NULL,
  unit         TEXT,
  sort_order   INT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS work_norm_categories (
  code              TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  sort_order        INT NOT NULL DEFAULT 0,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  methods_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  input_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes             TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS work_norm_rates (
  id              BIGSERIAL PRIMARY KEY,
  category_code   TEXT NOT NULL REFERENCES work_norm_categories(code) ON DELETE CASCADE,
  method_code     TEXT,
  object_code     TEXT,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  unit            TEXT NOT NULL,
  calc_kind       TEXT NOT NULL DEFAULT 'per_unit_shift'
                  CHECK (calc_kind IN ('per_unit_shift','days_per_unit','min_per_unit','mh_per_unit','kg_per_m','fixed_days')),
  rate_loose      NUMERIC,
  rate_medium     NUMERIC,
  rate_hard       NUMERIC,
  rate_default    NUMERIC,
  crew_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  params_json     JSONB NOT NULL DEFAULT '{}'::jsonb,
  basis           TEXT NOT NULL DEFAULT 'expert',
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  sort_order      INT NOT NULL DEFAULT 0,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      INT REFERENCES users(id),
  UNIQUE (category_code, code)
);

CREATE INDEX IF NOT EXISTS idx_work_norm_rates_cat ON work_norm_rates(category_code) WHERE is_active;

CREATE TABLE IF NOT EXISTS work_norm_coeffs (
  id              BIGSERIAL PRIMARY KEY,
  category_code   TEXT REFERENCES work_norm_categories(code) ON DELETE CASCADE,
  coeff_code      TEXT NOT NULL,
  label           TEXT NOT NULL,
  multiplier      NUMERIC NOT NULL DEFAULT 1,
  applies_to      TEXT NOT NULL DEFAULT 'productivity',
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (category_code, coeff_code)
);

CREATE TABLE IF NOT EXISTS work_norm_chemistry (
  id              BIGSERIAL PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL,
  price_kg        NUMERIC,
  kg_per_m2       NUMERIC,
  kg_per_m3       NUMERIC,
  deposit_type    TEXT,
  category_codes  TEXT[] NOT NULL DEFAULT '{}',
  notes           TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      INT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS work_norm_equipment (
  id                 BIGSERIAL PRIMARY KEY,
  category_code      TEXT REFERENCES work_norm_categories(code) ON DELETE CASCADE,
  code               TEXT NOT NULL,
  name               TEXT NOT NULL,
  qty_formula        TEXT,
  stub_price_rub     NUMERIC,
  capex_in_cost_pct  NUMERIC,
  purpose            TEXT,
  notes              TEXT,
  is_active          BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (category_code, code)
);

CREATE TABLE IF NOT EXISTS work_norm_change_log (
  id             BIGSERIAL PRIMARY KEY,
  entity_type    TEXT NOT NULL,
  entity_id      TEXT,
  category_code  TEXT,
  action         TEXT NOT NULL CHECK (action IN ('create','update','delete','import')),
  before_json    JSONB,
  after_json     JSONB,
  comment        TEXT NOT NULL,
  user_id        INT REFERENCES users(id),
  user_name      TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_work_norm_change_log_created ON work_norm_change_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_work_norm_change_log_cat ON work_norm_change_log(category_code);

-- ─── Globals seed (Апатит-отчёт + MODULE) ───────────────────────────────────
INSERT INTO work_norm_globals (key, value_num, label, unit, sort_order) VALUES
  ('vat_pct', 22, 'НДС', '%', 10),
  ('fot_tax_pct', 55, 'Налог на ФОТ', '%', 20),
  ('overhead_pct', 10, 'Накладные', '%', 30),
  ('consumables_pct', 3, 'Расходные', '%', 40),
  ('contingency_pct', 5, 'Непредвиденные', '%', 50),
  ('itr_rate', 10000, 'Ставка ИТР / РП', '₽/смена', 60),
  ('road_day_rate', 3000, 'День дороги', '₽/чел', 70),
  ('meals_per_day', 1000, 'Пайковые', '₽/чел·день', 80),
  ('lodging_per_night', 1250, 'Проживание', '₽/чел·ночь', 90),
  ('siz_per_person', 15000, 'СИЗ + спецодежда', '₽/чел', 100),
  ('point_value', 500, 'Балл', '₽', 110),
  ('shift_hours', 12, 'Длина смены 24/7', 'ч', 120),
  ('shifts_per_day', 2, 'Смен в сутки', 'шт', 130),
  ('k_irv', 0.82, 'КИРВ', '', 140),
  ('capex_in_cost_pct', 30, 'Доля CAPEX оборудования в себестоимости', '%', 150),
  ('margin_per_person_day', 15000, 'Целевая маржа', '₽/чел·день', 160),
  ('max_parallel_posts', 2, 'Макс. параллельных постов', 'шт', 170)
ON CONFLICT (key) DO NOTHING;

-- ─── Categories ─────────────────────────────────────────────────────────────
INSERT INTO work_norm_categories (code, title, sort_order, methods_json, input_schema_json, notes) VALUES
('avo', 'АВО', 10,
  '[{"code":"outer","label":"Наружная очистка"},{"code":"tubes","label":"Трубки секции"}]'::jsonb,
  '{"methods":{"outer":{"fields":[{"key":"sections","label":"Секции","unit":"секц."},{"key":"surface_m2","label":"Площадь (опц.)","unit":"м²","optional":true}]},"tubes":{"fields":[{"key":"sections","label":"Секции","unit":"секц."}]}}}'::jsonb,
  'Якорь Апатит: 1.5 сут/секция, смена 1м+3сл'),
('tubes', 'Трубные пучки ТО', 20,
  '[{"code":"gdo","label":"ГДО"},{"code":"gmo","label":"ГМО"},{"code":"chem","label":"Химциркуляция"}]'::jsonb,
  '{"methods":{"gdo":{"fields":[{"key":"tubes","label":"Трубки","unit":"шт"},{"key":"diameter_mm","label":"Ø","unit":"мм","optional":true},{"key":"length_m","label":"Длина","unit":"м","optional":true}]},"gmo":{"fields":[{"key":"tubes","label":"Трубки","unit":"шт"}]},"chem":{"fields":[{"key":"tubes","label":"Трубки","unit":"шт"}]}}}'::jsonb,
  'MODULE 130/95/40 труб/смену; ГЭСН 15-04-002'),
('plates', 'Пластинчатые ТО', 30,
  '[{"code":"hydro_dis","label":"Разборная ГДО"},{"code":"chem_cip","label":"Безразборная химия"}]'::jsonb,
  '{"methods":{"hydro_dis":{"fields":[{"key":"apparatus","label":"Аппараты","unit":"шт"},{"key":"surface_m2","label":"Площадь","unit":"м²","optional":true}]},"chem_cip":{"fields":[{"key":"circuit_m3","label":"Объём контура","unit":"м³"},{"key":"cycles","label":"Циклы","unit":"шт"}]}}}'::jsonb,
  'Апатит: 3.0 сут на аппарат (разбор+мойка+сбор), 1м+2сл'),
('boilers', 'Котлы', 40,
  '[{"code":"chem","label":"Химия"},{"code":"hydro","label":"Гидро"},{"code":"mech","label":"Механика"},{"code":"complex","label":"Комплекс"}]'::jsonb,
  '{"methods":{"chem":{"fields":[{"key":"boilers","label":"Котлы","unit":"шт"},{"key":"circuit_m3","label":"Объём контура","unit":"м³","optional":true}]},"hydro":{"fields":[{"key":"boilers","label":"Котлы","unit":"шт"}]},"mech":{"fields":[{"key":"boilers","label":"Котлы","unit":"шт"}]},"complex":{"fields":[{"key":"boilers","label":"Котлы","unit":"шт"}]}}}'::jsonb,
  'ГЭСНр 69-12'),
('vessels', 'Ёмкости и резервуары', 50,
  '[{"code":"clean","label":"Зачистка"}]'::jsonb,
  '{"methods":{"clean":{"fields":[{"key":"volume_m3","label":"Объём","unit":"м³"},{"key":"deposit_cm","label":"Отложения","unit":"см","optional":true}]}}}'::jsonb,
  'ГЭСНр 67-04 РВС'),
('pipelines', 'Трубопроводы', 60,
  '[{"code":"chem_ops","label":"Химпромывка экспл."},{"code":"pickle","label":"Протравка / предпусковая"},{"code":"aspo","label":"АСПО / нефть"},{"code":"hydro","label":"Гидроструй"}]'::jsonb,
  '{"methods":{"chem_ops":{"fields":[{"key":"length_m","label":"Длина","unit":"м"},{"key":"dn_mm","label":"Ду","unit":"мм","optional":true},{"key":"circuit_m3","label":"Объём контура","unit":"м³","optional":true}]},"pickle":{"fields":[{"key":"length_m","label":"Длина","unit":"м"},{"key":"dn_mm","label":"Ду","unit":"мм"}]},"aspo":{"fields":[{"key":"length_m","label":"Длина","unit":"м"}]},"hydro":{"fields":[{"key":"length_m","label":"Длина","unit":"м.п."}]}}}'::jsonb,
  'Протравка: кг кислоты/м по Ду; хим — контур/циклы'),
('chem_circuits', 'Химконтуры ТО / систем', 70,
  '[{"code":"cip","label":"CIP-контур"}]'::jsonb,
  '{"methods":{"cip":{"fields":[{"key":"circuit_m3","label":"Объём контура","unit":"м³"},{"key":"cycles","label":"Циклы","unit":"шт"},{"key":"conc_pct","label":"Концентрация","unit":"%","optional":true}]}}}'::jsonb,
  'MODULE ~8 ч/контур, 3 чел'),
('towers_hvac', 'Градирни и инженерные системы', 80,
  '[{"code":"tower","label":"Градирня"},{"code":"heating","label":"Отопление / ГВС / хладо"},{"code":"itp","label":"ИТП / ЦТП"},{"code":"pneumo","label":"Пневмоимпульс"}]'::jsonb,
  '{"methods":{"tower":{"fields":[{"key":"surface_m2","label":"Площадь орошения","unit":"м²"}]},"heating":{"fields":[{"key":"circuit_m3","label":"Объём системы","unit":"м³"}]},"itp":{"fields":[{"key":"circuit_m3","label":"Объём","unit":"м³"}]},"pneumo":{"fields":[{"key":"length_m","label":"Длина сети","unit":"м"}]}}}'::jsonb,
  NULL),
('vent_sewer', 'Вентиляция и канализация', 90,
  '[{"code":"vent","label":"Воздуховоды"},{"code":"disinfect","label":"Дезинфекция"},{"code":"sewer","label":"Канализация / приямки"}]'::jsonb,
  '{"methods":{"vent":{"fields":[{"key":"surface_m2","label":"Площадь","unit":"м²"}]},"disinfect":{"fields":[{"key":"surface_m2","label":"Площадь","unit":"м²"}]},"sewer":{"fields":[{"key":"length_m","label":"Длина / точки","unit":"м"}]}}}'::jsonb,
  'Заполнить по факту объектов'),
('repair_weld', 'Ремонт и сварка ТО', 100,
  '[{"code":"compabloc","label":"Компаблок"},{"code":"plates_pack","label":"Пакет пластин"},{"code":"weld","label":"Сварка"}]'::jsonb,
  '{"methods":{"compabloc":{"fields":[{"key":"qty","label":"Кол-во","unit":"шт"}]},"plates_pack":{"fields":[{"key":"qty","label":"Пакеты","unit":"шт"}]},"weld":{"fields":[{"key":"length_m","label":"Шов","unit":"м"}]}}}'::jsonb,
  NULL),
('insulation', 'Теплоизоляция', 110,
  '[{"code":"insul","label":"Изоляция"}]'::jsonb,
  '{"methods":{"insul":{"fields":[{"key":"surface_m2","label":"Площадь","unit":"м²"}]}}}'::jsonb,
  'ЕНиР-ориентир чел·ч/м²')
ON CONFLICT (code) DO NOTHING;

-- ─── Rates seed ─────────────────────────────────────────────────────────────
INSERT INTO work_norm_rates (category_code, method_code, code, name, unit, calc_kind, rate_loose, rate_medium, rate_hard, rate_default, crew_json, basis, notes, sort_order) VALUES
-- AVO
('avo', 'outer', 'avo_section_days', 'АВО — сутки на секцию (наружная)', 'сут/секц.', 'days_per_unit', 1.2, 1.5, 2.0, 1.5,
  '{"master":1,"exec":3,"observer_rule":"none","shifts":1}'::jsonb, 'field', 'Апатит #1961; ГЭСНм 15-08', 10),
('avo', 'outer', 'avo_m2_shift', 'АВО — м²/смену исполнителя', 'м²/смену', 'per_unit_shift', 55, 35, 18, 35,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'expert', 'MODULE-norms §3.5', 20),
('avo', 'tubes', 'avo_section_tubes', 'АВО — сутки на секцию (трубки)', 'сут/секц.', 'days_per_unit', 1.5, 2.0, 3.0, 2.0,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'expert', 'ГЭСНм 15-08-003', 30),
-- Tubes
('tubes', 'gdo', 'tubes_per_shift_gdo', 'ГДО трубок — шт/смену исполнителя', 'труб/смену', 'per_unit_shift', 130, 95, 40, 95,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'expert', 'MODULE §3.5; fouling loose/medium/hard', 10),
('tubes', 'gmo', 'tubes_per_shift_gmo', 'ГМО трубок — шт/смену', 'труб/смену', 'per_unit_shift', 100, 70, 30, 70,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'expert', 'ГЭСНм 15-04-002-02', 20),
('tubes', 'chem', 'tubes_chem_100', 'Химчистка пучка — на 100 трубок', 'чел·ч/100 труб', 'mh_per_unit', NULL, 22.8, NULL, 22.8,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb, 'gesn', 'ГЭСНм 15-04-002-01', 30),
('tubes', 'gdo', 'tubes_min_per_tube', 'ГДО — мин/трубка (базовая, уточнять по Ø×L)', 'мин/труб', 'min_per_unit', 1.0, 2.0, 5.0, 2.0,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'field', 'Апатит: Ø16 L5.5≈1.83 мин; Ø19 L9≈3.0 мин — править params', 40),
-- Plates
('plates', 'hydro_dis', 'plates_days_per_app', 'Пластинчатый — сутки на аппарат (разбор)', 'сут/апп.', 'days_per_unit', 2.5, 3.0, 4.0, 3.0,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb, 'field', 'Апатит: разбор+мойка+сбор', 10),
('plates', 'chem_cip', 'plates_cip_hours', 'Безразборная химия — ч/контур', 'ч/контур', 'mh_per_unit', NULL, 8, NULL, 8,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb, 'expert', 'MODULE CHEM', 20),
-- Boilers
('boilers', 'chem', 'boiler_chem_mh', 'Химочистка котла — чел·ч (ориентир)', 'чел·ч/котёл', 'mh_per_unit', 40, 80, 160, 80,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'gesn', 'ГЭСНр 69-12; зависит от вскрытия', 10),
('boilers', 'hydro', 'boiler_hydro_days', 'Гидроочистка котла — сут', 'сут/котёл', 'days_per_unit', 2, 3, 5, 3,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'expert', 'Заполнить по факту', 20),
('boilers', 'mech', 'boiler_mech_days', 'Механическая чистка котла — сут', 'сут/котёл', 'days_per_unit', 3, 5, 8, 5,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb, 'expert', NULL, 30),
-- Vessels
('vessels', 'clean', 'vessel_mh_per_m3', 'Зачистка ёмкости — чел·ч/м³', 'чел·ч/м³', 'mh_per_unit', 0.15, 0.25, 0.4, 0.25,
  '{"master":2,"exec":6,"observer_rule":"1:1"}'::jsonb, 'gesn', 'Ориентир от ГЭСНр 67-04 (РВС 1000м³ ≈248 чел·ч)', 10),
-- Pipelines
('pipelines', 'chem_ops', 'pipe_chem_m_day', 'Химпромывка труб — м/смену бригады', 'м/смену', 'per_unit_shift', 80, 50, 25, 50,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'expert', 'Зависит от Ду и отложений', 10),
('pipelines', 'pickle', 'pipe_pickle_kg_m', 'Протравка — кг кислоты / м (базовый Ду50)', 'кг/м', 'kg_per_m', NULL, 0.14, NULL, 0.14,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb, 'snip', 'СНиП 12-753 ориентир; править по Ду в params', 20),
('pipelines', 'pickle', 'pipe_pickle_days', 'Протравка — сут на объект (выдержка)', 'сут', 'fixed_days', NULL, 2, NULL, 2,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb, 'expert', 'Выдержка 6–12 ч + промывка; не путать с труб/смену', 21),
('pipelines', 'aspo', 'pipe_aspo_m_day', 'АСПО — м/смену', 'м/смену', 'per_unit_shift', 40, 25, 12, 25,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb, 'expert', NULL, 30),
('pipelines', 'hydro', 'pipe_hydro_lm', 'Гидроструй труб — м.п./смену', 'м.п./смену', 'per_unit_shift', 60, 40, 20, 40,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'expert', NULL, 40),
-- Chem circuits
('chem_circuits', 'cip', 'cip_hours_circuit', 'CIP — ч/контур', 'ч/контур', 'mh_per_unit', NULL, 8, NULL, 8,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb, 'expert', 'MODULE', 10),
-- Towers HVAC
('towers_hvac', 'tower', 'tower_m2_shift', 'Градирня — м²/смену', 'м²/смену', 'per_unit_shift', 40, 25, 15, 25,
  '{"master":1,"exec":4,"observer_rule":"none"}'::jsonb, 'expert', 'Заполнить по факту', 10),
('towers_hvac', 'heating', 'heating_m3_shift', 'Отопление/ГВС — м³ системы/смену', 'м³/смену', 'per_unit_shift', 15, 10, 5, 10,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'expert', NULL, 20),
('towers_hvac', 'itp', 'itp_days', 'ИТП/ЦТП — сут на объект', 'сут', 'fixed_days', NULL, 3, NULL, 3,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'expert', NULL, 30),
('towers_hvac', 'pneumo', 'pneumo_m_day', 'Пневмоимпульс — м/смену', 'м/смену', 'per_unit_shift', 100, 70, 40, 70,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb, 'expert', NULL, 40),
-- Vent sewer
('vent_sewer', 'vent', 'vent_m2_shift', 'Воздуховоды — м²/смену', 'м²/смену', 'per_unit_shift', NULL, 50, NULL, 50,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'expert', 'Заполнить по факту', 10),
('vent_sewer', 'disinfect', 'disinfect_m2', 'Дезинфекция — м²/смену', 'м²/смену', 'per_unit_shift', NULL, 80, NULL, 80,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb, 'expert', NULL, 20),
('vent_sewer', 'sewer', 'sewer_m_day', 'Канализация — м/смену', 'м/смену', 'per_unit_shift', NULL, 30, NULL, 30,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'expert', NULL, 30),
-- Repair
('repair_weld', 'compabloc', 'compabloc_days', 'Ремонт Компаблок — сут/шт', 'сут/шт', 'days_per_unit', NULL, 2, NULL, 2,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb, 'expert', 'Заполнить по факту', 10),
('repair_weld', 'plates_pack', 'plates_pack_days', 'Замена пакета пластин — сут', 'сут/шт', 'days_per_unit', NULL, 1.5, NULL, 1.5,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb, 'expert', NULL, 20),
('repair_weld', 'weld', 'weld_m_shift', 'Сварка — м шва/смену', 'м/смену', 'per_unit_shift', NULL, 8, NULL, 8,
  '{"master":1,"exec":2,"observer_rule":"none"}'::jsonb, 'expert', NULL, 30),
-- Insulation
('insulation', 'insul', 'insul_mh_m2', 'Изоляция — чел·ч/м²', 'чел·ч/м²', 'mh_per_unit', 0.4, 0.6, 1.0, 0.6,
  '{"master":1,"exec":3,"observer_rule":"none"}'::jsonb, 'enir', 'MODULE/ЕНиР ориентир', 10)
ON CONFLICT (category_code, code) DO NOTHING;

-- Coeffs (global apply when category_code NULL — use sentinel category via NULL)
-- category_code NULL = глобальный коэффициент (для всех направлений)
INSERT INTO work_norm_coeffs (category_code, coeff_code, label, multiplier, applies_to, notes)
SELECT NULL, v.coeff_code, v.label, v.multiplier, v.applies_to, v.notes
FROM (VALUES
  ('height', 'Высотные работы >5 м', 1.15::numeric, 'productivity', NULL::text),
  ('ozp', 'ОЗП / замкнутое пространство', 1.25, 'productivity', '1:1 наблюдающий — в crew_json'),
  ('winter', 'Зима <-15C', 1.15, 'productivity', NULL),
  ('night', 'Ночные смены', 1.10, 'productivity', NULL),
  ('gas', 'Газоопасная среда', 1.20, 'productivity', NULL),
  ('tight', 'Стеснённость', 1.15, 'productivity', NULL)
) AS v(coeff_code, label, multiplier, applies_to, notes)
WHERE NOT EXISTS (
  SELECT 1 FROM work_norm_coeffs c
  WHERE c.category_code IS NULL AND c.coeff_code = v.coeff_code
);

-- Chemistry from calc_norms.js
INSERT INTO work_norm_chemistry (code, name, price_kg, kg_per_m2, kg_per_m3, deposit_type, category_codes, notes) VALUES
('acid_isk', 'Кислотный ИСК-1', 180, 0.5, 3, 'scale', ARRAY['chem_circuits','plates','boilers','pipelines'], NULL),
('alkali_sh', 'Щелочной ЩС-2', 220, 0.4, 2, 'organic', ARRAY['chem_circuits','boilers'], NULL),
('solvent', 'Растворитель АСПО', 350, 0.8, 5, 'aspo', ARRAY['pipelines','vessels'], NULL),
('passivator', 'Пассиватор П-1', 400, 0.1, 0.5, 'finish', ARRAY['pipelines','chem_circuits','boilers'], NULL),
('ortho', 'Ортофосфорная кислота', 150, 0.6, 4, 'scale', ARRAY['pipelines','boilers'], 'Протравка'),
('hydro_acid', 'Соляная кислота', 120, 0.7, 4.5, 'scale', ARRAY['chem_circuits','boilers','avo'], NULL),
('soda', 'Каустическая сода', 80, 0.3, 1.5, 'organic', ARRAY['chem_circuits','vessels'], NULL)
ON CONFLICT (code) DO NOTHING;

-- Equipment
INSERT INTO work_norm_equipment (category_code, code, name, qty_formula, stub_price_rub, capex_in_cost_pct, purpose, notes) VALUES
('tubes', 'avd_1000', 'АВД / Hammelmann ≥1000 бар', 'ceil(posts)', 4000000, 30, 'гидроструй трубок', 'Апатит: 2× в себес 30%'),
('tubes', 'lances', 'Гибкие копья/насадки', 'exec_per_shift * 2', 50000, NULL, 'чистка трубок', NULL),
('avo', 'avd_wash', 'Мойка ВД / орошение секций', '1', 800000, 30, 'наружная АВО', NULL),
('plates', 'cip_pump', 'Насос CIP', '1', 250000, NULL, 'безразборная химия', NULL),
('vessels', 'gas_analyzer', 'Газоанализатор', '2', 70000, NULL, 'ОЗП', NULL),
('pipelines', 'pickle_pump', 'Насос циркуляции протравки', '1', 200000, NULL, 'протравка', NULL),
('boilers', 'chem_tank', 'Ёмкость реагента', '1', 150000, NULL, 'химочистка', NULL)
ON CONFLICT (category_code, code) DO NOTHING;
