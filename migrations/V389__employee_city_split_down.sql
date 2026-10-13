-- V389 down: откат разведения «Город / Адрес».
-- ВНИМАНИЕ: восстанавливает city из резервной копии city_legacy — то есть
-- возвращает в поле «Город» полные адреса, как было до V389.
--
-- Семантика:
--   • было значение до V389 (city_legacy заполнен) → вернуть его как есть;
--   • города не было, а мы его записали (city_source заполнен) → вернуть NULL;
--   • запись создана уже после V389 (city_legacy NULL и city_source NULL) → не трогаем.
--
-- ПОРЯДОК ВАЖЕН: CHECK и индекс снимаем ДО восстановления city. Иначе строка
-- #9869 (адрес на 81 символ) нарушает chk_employees_city_length, транзакция
-- абортится, и откат не выполняется вовсе (реальный дефект, найденный верификатором).

-- 1. Снять CHECK и индекс — constraint блокирует возврат длинных адресов.
ALTER TABLE employees DROP CONSTRAINT IF EXISTS chk_employees_city_length;
DROP INDEX IF EXISTS idx_employees_city;

-- 2. Вернуть прежние значения city (только там, где есть снимок).
UPDATE employees
   SET city = city_legacy
 WHERE city_legacy IS NOT NULL
   AND btrim(city_legacy) <> ''
   AND city IS DISTINCT FROM city_legacy;

-- 3. Записи, где города до V389 не было (снимка нет), но мы его добавили —
--    вернуть в NULL, чтобы откат был честным.
UPDATE employees
   SET city = NULL
 WHERE city_legacy IS NULL
   AND city_source IS NOT NULL
   AND city IS NOT NULL;

-- 4. Служебные колонки больше не нужны.
ALTER TABLE employees DROP COLUMN IF EXISTS city_source;
ALTER TABLE employees DROP COLUMN IF EXISTS city_updated_at;
ALTER TABLE employees DROP COLUMN IF EXISTS city_legacy;
