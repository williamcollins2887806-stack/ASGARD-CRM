-- V416: короткое название заявки (генерирует ИИ) + структурированный объём работ.
--
-- Проблема (19.10.2026): карточка РП показывала названием ВЕСЬ текст письма
-- (work_description = body письма, до 2000 знаков). Директор видел «простыню»
-- вместо «Что нужно сделать». Плюс объём работ хранился одной парой
-- work_volume / work_volume_unit, а у чистки, мойки и сварки разные единицы
-- (м³, м², стыки, п.м.).
--
-- work_title        — короткое название работы (≤ 200), придумывает ИИ.
-- ai_scope_items    — [{name, volume, unit}] перечень объёмов по позициям,
--                     чтобы у каждой работы была СВОЯ единица.
-- ai_work_type уже есть (V-предыдущие).
--
-- Нумерация: V413 занят (d283_intake_backfill), V414 — отпуска, V415 — календарь,
-- поэтому pre_tender-миграция идёт как V416. На проде колонки уже созданы.

ALTER TABLE pre_tender_requests
  ADD COLUMN IF NOT EXISTS work_title varchar(200),
  ADD COLUMN IF NOT EXISTS ai_scope_items jsonb;

COMMENT ON COLUMN pre_tender_requests.work_title IS
  'V416: короткое название работы от ИИ. Пусто → фронт собирает из ai_work_type + объект.';
COMMENT ON COLUMN pre_tender_requests.ai_scope_items IS
  'V416: перечень объёмов [{name,volume,unit}] — у каждой работы своя единица.';
