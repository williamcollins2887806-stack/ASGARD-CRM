-- V233 DOWN: убираем entered_by_user_id с обоих таблиц.
DROP INDEX IF EXISTS idx_field_trip_stages_entered_by;
DROP INDEX IF EXISTS idx_field_checkins_entered_by;
ALTER TABLE field_trip_stages DROP COLUMN IF EXISTS entered_by_user_id;
ALTER TABLE field_checkins    DROP COLUMN IF EXISTS entered_by_user_id;
