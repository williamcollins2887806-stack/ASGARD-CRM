-- V487: расчётная модель v2 — параметры бригад и потерь, версия формулы, настройки UI.
--
-- Зачем отдельная миграция и почему ОНА ИДЁТ ПЕРВОЙ:
--   шаги расчёта (schedule-model, crew-plan, time-budget) читают crew_span,
--   master_span, observer_ratio и минуты смены. Если ключей нет, они получают
--   undefined → NaN в сроке и ФОТ. Поэтому миграция накатывается ДО кода.
--
-- Все вставки ON CONFLICT DO NOTHING: повторный прогон безопасен.

BEGIN;

-- ── 1. Параметры бригады ────────────────────────────────────────────────────
INSERT INTO work_norm_globals (key, value_num, label, unit, sort_order) VALUES
  ('crew_span',        5,    'Человек в бригаде (мастер + слесари)', 'чел',        140),
  ('master_span',      4,    'Слесарей на одного мастера',            'чел',        141),
  ('observer_ratio',   1.0,  'Наблюдающий на исполнителя (ОЗП)',      'коэф.',      142),
  ('duplier_ratio',    1.0,  'Дежурный снаружи на исполнителя (газ)', 'коэф.',      143),
  ('pto_threshold',    10,   'Позиций, с которых нужен ПТО',          'поз.',       144)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Потери времени внутри смены (уровень A) ──────────────────────────────
INSERT INTO work_norm_globals (key, value_num, label, unit, sort_order) VALUES
  ('shift_lunch_min',    60, 'Обед',                              'мин/смену', 145),
  ('shift_breaks_min',   30, 'Перекуры и физпаузы',               'мин/смену', 146),
  ('shift_pzr_min',      30, 'ПЗР (подготовительно-заключит.)',    'мин/смену', 147),
  ('shift_handover_min', 15, 'Передача смены',                    'мин/смену', 148),
  ('permit_daily_min',   30, 'Продление наряда-допуска',          'мин/смену', 149)
ON CONFLICT (key) DO NOTHING;

-- ── 3. Структурные потери (уровень B) ───────────────────────────────────────
INSERT INTO work_norm_globals (key, value_num, label, unit, sort_order) VALUES
  ('permit_setup_h',      1.00, 'Оформление наряда на аппарат',   'ч/аппарат', 150),
  ('move_intra_h',        0.67, 'Переход между аппаратами',       'ч/переход', 151),
  ('reloc_inter_zone_h',  4.00, 'Перевоз между цехами',           'ч/переход', 152),
  ('hookup_h',            1.00, 'Подключение/отключение обвязки',  'ч/аппарат', 153),
  ('scaffold_h',          4.00, 'Монтаж/демонтаж лесов',          'ч/секцию',  154),
  ('accept_h',            2.00, 'Приёмка скрытых работ',          'ч/этап',    155)
ON CONFLICT (key) DO NOTHING;

-- ── 4. Календарные потери (уровень C) ───────────────────────────────────────
INSERT INTO work_norm_globals (key, value_num, label, unit, sort_order) VALUES
  ('wait_default_days',   0,    'Ожидание доступа по умолчанию',  'сут/заезд', 156),
  ('weather_days_per_month', 0, 'Погодные простои',               'сут/мес',   157)
ON CONFLICT (key) DO NOTHING;

-- ── 5. Базис нормы: gross (потери внутри) или net (добавлять) ───────────────
--
-- ВАЖНО: k_irv (0.82) применяется ТОЛЬКО в ветках min_per_unit и
-- deriveFromExperience. Ветки per_unit_shift, days_per_unit, fixed_days,
-- hours_per_cycle считают без него. Поэтому ставить всем «gross» нельзя —
-- это даст недобор на самых массовых нормах (трубки).
--
-- Разбивка по calc_kind:
--   min_per_unit               → gross_12h      (потери внутри минут)
--   mh_per_unit                → net_productive (kIrv не применяется)
--   per_unit_shift             → net_productive
--   hours_per_cycle            → net_productive
--   days_per_unit, fixed_days  → gross_calendar (календарные сутки, не добавлять)
UPDATE work_norm_rates
   SET params_json = jsonb_set(
         COALESCE(params_json, '{}'::jsonb),
         '{norm_basis}',
         to_jsonb(
           CASE calc_kind
             WHEN 'min_per_unit'  THEN 'gross_12h'
             WHEN 'days_per_unit' THEN 'gross_calendar'
             WHEN 'fixed_days'    THEN 'gross_calendar'
             ELSE 'net_productive'
           END
         ),
         true
       )
 WHERE params_json->>'norm_basis' IS NULL;

-- ── 6. Версия расчётной формулы ─────────────────────────────────────────────
-- Хранится в report_json (смета asgard_v1 живёт там, а не в estimates).
-- Значение по умолчанию читается кодом как 1; эта миграция DDL не требует.
COMMENT ON TABLE work_norm_rates IS
  'Справочник норм. params_json.norm_basis: gross_12h | net_productive | gross_calendar. '
  'Версия формулы сметы хранится в tender_rp_reviews.report_json.calc_formula_version (1 = старая, 2 = новая).';

-- ── 7. Настройки интерфейса пользователя ────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_ui_prefs (
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, key)
);

CREATE INDEX IF NOT EXISTS idx_user_ui_prefs_user ON user_ui_prefs(user_id);

COMMENT ON TABLE user_ui_prefs IS
  'Пользовательские настройки интерфейса (свёрнутые группы ДВ и т.п.). '
  'Ключ collapsed_periods: { "<период>": true }.';

COMMIT;
