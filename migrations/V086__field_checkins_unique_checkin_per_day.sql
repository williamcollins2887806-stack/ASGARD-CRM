-- Защита от дубликатов чекинов на одну дату + работу + сотрудника.
-- cancelled чекины исключаем, чтобы можно было пересоздать после отмены.
--
-- Контекст: до этой миграции 4 эндпоинта INSERT в field_checkins не проверяли
-- наличие существующего чекина → мастер создавал дубли при повторном вводе.
-- Данные очищены 2026-04-20 (см. scripts/data-fixes/2026-04-20_cleanup_checkin_duplicates.sql)

CREATE UNIQUE INDEX IF NOT EXISTS
  ux_field_checkins_no_duplicate_per_day
  ON field_checkins (employee_id, date, work_id)
  WHERE status != 'cancelled';
