-- ═══════════════════════════════════════════════════════════════════════════
-- V472. Альтернативные единицы норм, область применимости и доверие
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Зачем. Из 87 норм справочника нормативных (ГЭСН/СНиП/ЕНИР) — 7. Остальные
-- собраны из интернета или оценены. При этом норма без границ применимости
-- врёт на части объектов: «чел·ч на м³ ёмкости» совпадает с площадной нормой
-- ГЭСН только для резервуаров Ø20–25 м, на РВС-1000 занижает трудозатраты
-- почти вдвое (проверено исследованием 06.11.2026).
--
-- Поэтому к каждой норме добавляются:
--   applicability — где она верна (диапазон габаритов, тип отложения, способ);
--   confidence    — насколько ей верить, 0..1.
-- И таблицы пересчёта единиц из ведомости объёмов в единицу нормы.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Область применимости и доверие у нормы --------------------------------

ALTER TABLE work_norm_rates
  ADD COLUMN IF NOT EXISTS applicability JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE work_norm_rates
  ADD COLUMN IF NOT EXISTS confidence NUMERIC(3,2);

COMMENT ON COLUMN work_norm_rates.applicability IS
  'Где норма верна: {"min_value":..,"max_value":..,"value_field":"volume_m3","fouling":["light","medium"],"method_note":"..."} Пусто = без ограничений.';
COMMENT ON COLUMN work_norm_rates.confidence IS
  'Доверие 0..1. normative=0.95, field=0.9, research=0.5, expert=0.25. Пусто = выводится из basis.';

-- Первичное заполнение по происхождению: нормативное — высокое доверие,
-- research — среднее, expert — низкое. Дальше правится вручную.
UPDATE work_norm_rates SET confidence =
  CASE lower(COALESCE(basis, ''))
    WHEN 'gesn' THEN 0.95
    WHEN 'snip' THEN 0.95
    WHEN 'enir' THEN 0.92
    WHEN 'field' THEN 0.90
    WHEN 'research' THEN 0.50
    WHEN 'research_seed' THEN 0.45
    WHEN 'expert' THEN 0.25
    WHEN 'mimir_smeta' THEN 0.35
    WHEN 'mimir_expert' THEN 0.30
    ELSE 0.40
  END
WHERE confidence IS NULL;

CREATE INDEX IF NOT EXISTS idx_work_norm_rates_confidence
  ON work_norm_rates(confidence);

-- 2. Правила пересчёта единиц ----------------------------------------------
--
-- Ведомость объёмов приходит в разных единицах: м², тонны, штуки, мм, дюймы.
-- Норма считает в своей (обычно м³, м², трубки, стык). Здесь описано, как
-- привести одно к другому — с указанием, какой параметр для этого нужен.

CREATE TABLE IF NOT EXISTS work_norm_unit_conversions (
  id SERIAL PRIMARY KEY,
  category_code TEXT NOT NULL,
  method_code TEXT,
  from_unit TEXT NOT NULL,
  to_field TEXT NOT NULL,
  formula_kind TEXT NOT NULL,
  factor NUMERIC,
  needs_param TEXT,
  fallback_typical NUMERIC,
  note TEXT,
  source_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_code, method_code, from_unit, to_field)
);

COMMENT ON TABLE work_norm_unit_conversions IS
  'Пересчёт единицы из ВОР в единицу нормы. formula_kind: multiply | divide | geometry_cylinder | pipe_weld_length | dn_from_inch | sum_area.';

COMMENT ON COLUMN work_norm_unit_conversions.needs_param IS
  'Какой параметр нужен, если его нет в ВОР: thickness_mm | density_t_m3 | dn_mm | diameter_m | height_m.';

COMMENT ON COLUMN work_norm_unit_conversions.fallback_typical IS
  'Типовое значение параметра, если РП разрешил продолжить без данных. Применяется с пометкой «допущение».';

-- 3. Типовые параметры отложений -------------------------------------------
--
-- Только то, где есть проверяемый источник. Насыпной плотности накипи и
-- толщины слоя в шламовых баках в проверяемых источниках НЕТ — эти строки
-- намеренно отсутствуют, чтобы система не подставляла выдумку.

CREATE TABLE IF NOT EXISTS work_norm_layer_defaults (
  id SERIAL PRIMARY KEY,
  deposit_type TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  thickness_min_mm NUMERIC,
  thickness_typical_mm NUMERIC,
  thickness_max_mm NUMERIC,
  density_min_t_m3 NUMERIC,
  density_typical_t_m3 NUMERIC,
  density_max_t_m3 NUMERIC,
  source_note TEXT,
  source_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

COMMENT ON TABLE work_norm_layer_defaults IS
  'Типовые толщины и плотности отложений. Пустое поле = данных нет, подставлять нельзя.';

-- ── Заполнение правил пересчёта ────────────────────────────────────────────

-- Ёмкости: м² стенок × толщина слоя → м³ отложений.
INSERT INTO work_norm_unit_conversions
  (category_code, method_code, from_unit, to_field, formula_kind, factor, needs_param, fallback_typical, note, source_url)
VALUES
  ('vessels', 'clean', 'м²', 'volume_m3', 'multiply', 1, 'thickness_mm', 50,
   'Площадь стенок и днища × толщина слоя. Толщина обязательна: без неё объём не выводится.',
   'ГОСТ 8.586 / практика зачистки РВС'),
  ('vessels', 'clean', 'м2', 'volume_m3', 'multiply', 1, 'thickness_mm', 50,
   'То же, латинская запись м2.', NULL),
  ('vessels', 'clean', 'т', 'volume_m3', 'divide', 1, 'density_t_m3', 1.3,
   'Масса отложений / плотность. Плотность зависит от типа отложений — см. work_norm_layer_defaults.',
   'Насыпная плотность шлама 1,2–1,4 т/м³'),
  ('vessels', 'clean', 'литр', 'volume_m3', 'divide', 1000, NULL, NULL,
   'Литры / 1000.', NULL),
  ('vessels', 'clean', 'л', 'volume_m3', 'divide', 1000, NULL, NULL,
   'Литры / 1000.', NULL)
ON CONFLICT (category_code, method_code, from_unit, to_field) DO NOTHING;

-- Трубные пучки: м² поверхности ↔ трубки. Нужны Ø и длина трубки.
INSERT INTO work_norm_unit_conversions
  (category_code, method_code, from_unit, to_field, formula_kind, factor, needs_param, fallback_typical, note, source_url)
VALUES
  ('tubes', 'gdo', 'м²', 'tubes', 'multiply', 1, 'diameter_mm', 20,
   'S = π·d·L·N, отсюда N = S/(π·d·L). Нужны Ø и длина трубки. Считать по ВНУТРЕННЕМУ диаметру: чистят изнутри, разница с наружным 11–19%.',
   'ГОСТ 15122-79, проверено на 36 строках, отклонение ≤2,6%'),
  ('tubes', 'gmo', 'м²', 'tubes', 'multiply', 1, 'diameter_mm', 20,
   'То же: N = S/(π·d·L) по внутреннему диаметру.', 'ГОСТ 15122-79'),
  ('tubes', 'chem', 'м²', 'tubes', 'multiply', 1, 'diameter_mm', 20,
   'То же: N = S/(π·d·L) по внутреннему диаметру.', 'ГОСТ 15122-79')
ON CONFLICT (category_code, method_code, from_unit, to_field) DO NOTHING;

-- Пластинчатые: м² ↔ пластины. S = f·(N−2), не f·N.
INSERT INTO work_norm_unit_conversions
  (category_code, method_code, from_unit, to_field, formula_kind, factor, needs_param, fallback_typical, note, source_url)
VALUES
  ('plates', 'hydro_dis', 'пластины', 'surface_m2', 'multiply', 0.5, 'area_per_plate_m2', 0.5,
   'S = f·(N−2). Формула f·N завышает до +60% на малых аппаратах. Площадь одной пластины нужна из паспорта.',
   'ГОСТ 15518-87, проверено на 20 строках'),
  ('plates', 'chem_cip', 'м²', 'circuit_m3', 'multiply', 1, 'thickness_mm', 50,
   'Площадь × толщина слоя → объём отложений, не объём контура. Для CIP нужен объём контура из паспорта.',
   NULL)
ON CONFLICT (category_code, method_code, from_unit, to_field) DO NOTHING;

-- Сварка: длина шва из стыка и диаметра.
-- ВНИМАНИЕ: дюймы НЕЛЬЗЯ умножать на 25,4. «2 дюйма» — это DN50 при
-- наружном 60,3 мм (EN/DIN) или 57 мм (ГОСТ 8732). Умножение даёт 50,8 мм
-- и занижает длину шва на 19%. Проверено исследованием 06.11.2026.
INSERT INTO work_norm_unit_conversions
  (category_code, method_code, from_unit, to_field, formula_kind, factor, needs_param, fallback_typical, note, source_url)
VALUES
  ('repair_weld', 'weld', 'м', 'joints', 'pipe_weld_length', 1, 'dn_mm', 159,
   'Один стыковой шов трубы = π·D метров шва (наружный диаметр). Обратный пересчёт: N = L/(π·D).',
   'ГОСТ 16037-80, длина шва по наружному диаметру'),
  ('repair_weld', 'weld', 'мм', 'joints', 'pipe_weld_length', 1, 'dn_mm', 159,
   'Миллиметры шва → стыки: N = (L/1000)/(π·D).', 'ГОСТ 16037-80'),
  ('repair_weld', 'weld', 'см', 'joints', 'pipe_weld_length', 1, 'dn_mm', 159,
   'Сантиметры шва → стыки: N = (L/100)/(π·D).', 'ГОСТ 16037-80'),
  ('repair_weld', 'weld', 'дюйм', 'dn_mm', 'dn_from_inch', NULL, NULL, NULL,
   'Дюймы → наружный диаметр по сортаменту EN/DIN 2448 (по умолчанию) либо ГОСТ 8732. НЕ умножать на 25,4: 2″ это 60,3 или 57 мм, а не 50,8.',
   'Таблица Ду/DN/NPS/OD: DIN 2448, ГОСТ 3262-75, ГОСТ 8732-78')
ON CONFLICT (category_code, method_code, from_unit, to_field) DO NOTHING;

-- Теплоизоляция и площади: м² как есть.
INSERT INTO work_norm_unit_conversions
  (category_code, method_code, from_unit, to_field, formula_kind, factor, needs_param, note)
VALUES
  ('insulation', 'insul', 'м2', 'surface_m2', 'multiply', 1, NULL, 'Латинская запись м2 → м².'),
  ('boilers', 'hydro', 'м2', 'surface_m2', 'multiply', 1, NULL, 'Латинская запись м2 → м².'),
  ('boilers', 'mech', 'м2', 'surface_m2', 'multiply', 1, NULL, 'Латинская запись м2 → м².'),
  ('boilers', 'complex', 'м2', 'surface_m2', 'multiply', 1, NULL, 'Латинская запись м2 → м².'),
  ('avo', 'outer', 'м2', 'surface_m2', 'multiply', 1, NULL, 'Латинская запись м2 → м².'),
  ('vent_sewer', 'disinfect', 'м2', 'surface_m2', 'multiply', 1, NULL, 'Латинская запись м2 → м².'),
  ('towers_hvac', 'tower', 'м2', 'surface_m2', 'multiply', 1, NULL, 'Латинская запись м2 → м².')
ON CONFLICT (category_code, method_code, from_unit, to_field) DO NOTHING;

-- ── Дюймовый сортамент: два стандарта ──────────────────────────────────────
-- При одном DN наружный диаметр РАЗНЫЙ в EN/DIN и ГОСТ. Смешивание даёт
-- ошибку в длине шва до 6%, а на 100 стыках — уже метры и часы.
-- Значения сверены с таблицей Ду/DN/NPS/OD.

CREATE TABLE IF NOT EXISTS work_norm_inch_sizes (
  inch TEXT PRIMARY KEY,
  dn_mm INTEGER NOT NULL,
  od_eu_mm NUMERIC,
  od_gost_mm NUMERIC,
  source_note TEXT
);

INSERT INTO work_norm_inch_sizes (inch, dn_mm, od_eu_mm, od_gost_mm, source_note) VALUES
  ('1/4',   8,   13.5,  13.5,  'DN8'),
  ('3/8',   10,  17.2,  17.0,  'DN10'),
  ('1/2',   15,  21.3,  21.3,  'DN15'),
  ('3/4',   20,  26.9,  26.8,  'DN20'),
  ('1',     25,  33.7,  33.5,  'DN25'),
  ('1 1/4', 32,  42.4,  42.3,  'DN32'),
  ('1 1/2', 40,  48.3,  48.0,  'DN40'),
  ('2',     50,  60.3,  57.0,  'DN50: EN 60,3 / ГОСТ 8732 57,0 / ВГП 60,0'),
  ('2 1/2', 65,  76.1,  76.0,  'DN65'),
  ('3',     80,  88.9,  89.0,  'DN80'),
  ('3 1/2', 90,  101.6, 102.0, 'DN90'),
  ('4',     100, 114.3, 108.0, 'DN100: EN 114,3 / ГОСТ 8732 108,0'),
  ('5',     125, 139.7, 133.0, 'DN125'),
  ('6',     150, 168.3, 159.0, 'DN150: EN 168,3 / ГОСТ 159,0'),
  ('8',     200, 219.1, 219.0, 'DN200'),
  ('10',    250, 273.0, 273.0, 'DN250'),
  ('12',    300, 323.9, 325.0, 'DN300'),
  ('14',    350, 355.6, 377.0, 'DN350: расхождение 6% — самое опасное'),
  ('16',    400, 406.4, 426.0, 'DN400'),
  ('20',    500, 508.0, 530.0, 'DN500')
ON CONFLICT (inch) DO NOTHING;

-- Внимание: здесь только то, что подтверждено источником.
-- Насыпной плотности накипи и толщины слоя в бункерах в проверяемых
-- источниках нет — таких строк НЕТ намеренно.

INSERT INTO work_norm_layer_defaults
  (deposit_type, label, thickness_min_mm, thickness_typical_mm, thickness_max_mm,
   density_min_t_m3, density_typical_t_m3, density_max_t_m3, source_note, source_url)
VALUES
  ('oil_sludge', 'Нефтешлам', 5, 50, 300, 0.88, 0.92, 0.96,
   'Плотность нефтешлама 0,88–0,96 т/м³. Толщина слоя сильно зависит от объекта.',
   'Открытые данные нефтепереработки'),
  ('coke', 'Коксовые отложения', 5, 40, 200, 0.4, 0.45, 0.5,
   'Насыпная плотность кокса 0,4–0,5 т/м³; кажущаяся выше (0,8–1,4). Для объёма снятия брать насыпную.',
   'Справочные данные коксования'),
  ('ash', 'Золовые и шламовые отложения', 5, 50, 400, 0.6, 1.0, 1.3,
   'Плотность золы и шлама 0,6–1,3 т/м³ в зависимости от влажности.',
   'Теплотехнические справочники'),
  ('aspo', 'АСПО (асфальтосмолопарафины)', 3, 20, 100, 0.90, 0.92, 0.95,
   'Плотность АСПО около 0,92 т/м³.',
   'Отраслевые данные нефтедобычи'),
  ('bio', 'Биологические отложения', 1, 5, 30, 0.01, 0.04, 0.07,
   'Биоплёнка имеет низкую плотность 0,013–0,066 т/м³, объём снятия мал, но трудозатраты высокие.',
   'Данные водоподготовки'),
  ('scale_carbonate', 'Карбонатная накипь', 0.5, 2, 10, NULL, NULL, NULL,
   'ВНИМАНИЕ: 2,37–2,60 т/м³ — это ИСТИННАЯ плотность минерала, по ней нельзя считать объём снятой накипи. Насыпной плотности в проверяемых источниках нет — нужен замер мерным ящиком.',
   NULL)
ON CONFLICT (deposit_type) DO NOTHING;
