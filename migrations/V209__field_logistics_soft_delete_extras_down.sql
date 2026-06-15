-- V209 DOWN: убрать soft-delete и расширения формы field_logistics.
-- Внимание: вернуть NOT NULL на work_id безопасно только если в таблице нет
-- строк с work_id IS NULL — иначе ALTER упадёт. Сначала чистим/привязываем.

DROP INDEX IF EXISTS idx_field_logistics_alive;

ALTER TABLE field_logistics
  DROP COLUMN IF EXISTS driver_phone,
  DROP COLUMN IF EXISTS hotel_address,
  DROP COLUMN IF EXISTS referral_at,
  DROP COLUMN IF EXISTS deleted_at;

-- Восстановление NOT NULL пропускаем по умолчанию (может не пройти на живых данных).
-- Если действительно нужно: сначала
--   DELETE FROM field_logistics WHERE work_id IS NULL;
-- затем
--   ALTER TABLE field_logistics ALTER COLUMN work_id SET NOT NULL;
