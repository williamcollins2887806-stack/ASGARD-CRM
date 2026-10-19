-- V412 down: откат производственного календаря.
-- Удаляем только то, что добавил up (переносы по постановлениям), и снимаем колонки.
-- Строки, существовавшие до V412, остаются — но теряют разметку kind/title/source.

DROP INDEX IF EXISTS idx_work_calendar_kind;
DROP INDEX IF EXISTS idx_work_calendar_year;

-- Праздники ст.112, добавленные up (в исходной V394 их не было)
DELETE FROM work_calendar WHERE source IN ('ст. 112 ТК РФ', 'ПП РФ от 24.09.2025 N 1466', 'ПП РФ от 17.09.2026 N 1187')
   AND kind IN ('holiday', 'shift', 'working');

ALTER TABLE work_calendar DROP COLUMN IF EXISTS kind;
ALTER TABLE work_calendar DROP COLUMN IF EXISTS title;
ALTER TABLE work_calendar DROP COLUMN IF EXISTS source;
