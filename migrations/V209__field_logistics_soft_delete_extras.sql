-- V209: field_logistics — soft-delete + расширения формы (МО/жильё/трансфер).
--
-- 1) deleted_at — мягкое удаление (CLAUDE.md: V118+ паттерн). Все SELECT в коде должны
--    добавить `WHERE deleted_at IS NULL`. Партиальный индекс — для дешёвой фильтрации.
-- 2) referral_at — дата ВЫДАЧИ направления на МО (V186 добавил поле в field_trip_stages,
--    но удобнее иметь его рядом с самой записью field_logistics для UI).
-- 3) hotel_address — адрес гостиницы/жилья (раньше зашивали в description вручную).
-- 4) driver_phone — телефон водителя для трансфера (мобилка уже его рендерит,
--    но формы ввода не было).

ALTER TABLE field_logistics
  ADD COLUMN IF NOT EXISTS deleted_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS referral_at   DATE,
  ADD COLUMN IF NOT EXISTS hotel_address VARCHAR(255),
  ADD COLUMN IF NOT EXISTS driver_phone  VARCHAR(40);

-- 5) Релаксируем NOT NULL на work_id: общие направления на МО, обучения,
--    индивидуальные билеты часто не привязаны к проекту. Форма так и подразумевает
--    («— Не привязано к проекту —»), но миграция V060 жёстко требовала work_id —
--    создание без проекта падало с 500. Расход в work_expenses всё равно
--    создаётся только когда work_id есть (см. field-logistics.js).
ALTER TABLE field_logistics
  ALTER COLUMN work_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_field_logistics_alive
  ON field_logistics (employee_id, item_type)
  WHERE deleted_at IS NULL;
