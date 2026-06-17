-- DOWN: вернуть NOT NULL на field_trip_stages.work_id.
-- ВНИМАНИЕ: если в таблице есть строки с work_id IS NULL — миграция упадёт.
-- Перед откатом удалите/перепривяжите такие записи.

ALTER TABLE field_trip_stages
  ALTER COLUMN work_id SET NOT NULL;
