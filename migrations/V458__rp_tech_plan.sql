-- V458: техплан просчёта РП — сроки/заезды, бригада по ролям, МТР.
--
-- ЗАЧЕМ. До этой миграции техническая часть просчёта жила только строками
-- сметы: «Рабочий (исполнитель)», «АВД 500». Из такой сметы нельзя ответить
-- на вопросы заказчика «сколько человек, кого именно, сколько дней, что
-- за оборудование» — и ТКП получалось однострочным.
--
-- Один источник истины: report_json.tech_json. Из него рисуют
--   * анализ РП (public/assets/js/rp_review_modal.js),
--   * просчёт (public/assets/js/rp_calc_modal.js),
--   * карточка ТО (public/assets/js/to_calcs.js),
--   * ТКП через ИИ (src/services/tkp-ai-draft.js).
--
-- Структура tech_json:
--   {
--     schedule: { start_plan, work_days, trip_count, shift_mode, shift_hours,
--                 trips: [{ from, to, days }] },
--     crew: [{ role, role_code, count, shifts_per_day, hours_per_shift,
--              rate, source, employee_ids, note }],
--     mtr:  [{ name, inventory_number, equipment_id, qty, unit,
--              source, purpose, price, note }],
--     man_hours_total, filled_by: 'mimir'|'rp'|'ai_tkp', updated_at
--   }
--
-- Совместимость: DEFAULT '{}'. Старые просчёты читаются как раньше — код
-- проверяет наличие crew[]/mtr[] и падает обратно на параметры/скелет.

ALTER TABLE tender_rp_reviews
  ADD COLUMN IF NOT EXISTS tech_json JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN tender_rp_reviews.tech_json IS
  'Техплан просчёта: сроки/заезды, бригада по ролям, МТР (склад/закупка/аренда). Заполняет Мимар, правит РП.';

-- Быстрый поиск «есть ли техплан» в реестре/аналитике без чтения всего JSON.
CREATE INDEX IF NOT EXISTS idx_tender_rp_reviews_tech_json
  ON tender_rp_reviews USING GIN (tech_json);

-- Обратное заполнение: у закрытых просчётов техплан уже лежит в смете
-- (asgard_smeta.crew / .mtr / .schedule). Копируем его наверх, чтобы не
-- заставлять РП открывать каждую карточку руками.
UPDATE tender_rp_reviews
   SET tech_json = jsonb_build_object(
         'schedule', COALESCE(report_json->'asgard_smeta'->'schedule', '{}'::jsonb),
         'crew', COALESCE(report_json->'asgard_smeta'->'crew', '[]'::jsonb),
         'mtr', COALESCE(report_json->'asgard_smeta'->'mtr', '[]'::jsonb),
         'mtr_count', COALESCE(jsonb_array_length(report_json->'asgard_smeta'->'mtr'), 0),
         'filled_by', 'backfill'),
       updated_at = NOW()
 WHERE tech_json = '{}'::jsonb
   AND report_json->'asgard_smeta' IS NOT NULL
   AND (
     jsonb_array_length(COALESCE(report_json->'asgard_smeta'->'crew', '[]'::jsonb)) > 0
     OR jsonb_array_length(COALESCE(report_json->'asgard_smeta'->'mtr', '[]'::jsonb)) > 0
   );
