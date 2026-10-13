-- V389: развести «Город» и «Адрес» в карточке рабочего.
-- ═══════════════════════════════════════════════════════════════════════════
-- ПРОБЛЕМА (диагностика 13.10.2026)
--   employees.city — свободный текст, который заполняли ЧЕТЫРЕ источника:
--   v2-карточка (Personnel/EmployeeAnketaForm), vanilla-карточка (employee.js),
--   Field-PWA (PUT /field/worker/personal) и импорт/скрипты. Ни один не валидировал
--   значение, поэтому в «Город» попадал полный адрес:
--     #9869  «Ростовская обл., р-н Зерноградский, г. Зерноград, ул. им. Шукшина, д. 92, кв. 23»
--     #10227 «обл. Ленинградская, р-н Кировский, г. Шлиссельбург, ул. Чекалова, д. 48, к.1. кв.4»
--   На проде (610 записей): city заполнен у 142, из них 9 — адрес/регион/латиница;
--   ещё у 271 city пуст, но город выводится из address/registration_address.
--   Таблица «Дружина» и табель показывают city → в UI светился полный адрес.
--
-- ЧТО ДЕЛАЕТ МИГРАЦИЯ (только схема + резервная копия; данных НЕ трогает)
--   1. city_legacy     — резервная копия прежнего city (аудит/откат).
--   2. city_source     — происхождение city
--                        ('manual' | 'address' | 'registration_address' | 'city' | 'birth_place' | 'migrated_v389').
--   3. city_updated_at — когда город последний раз выведен из адреса.
--   4. idx_employees_city — индекс под фильтр «Город: все» в «Дружине».
--
-- ЗАПОЛНЕНИЕ ДАННЫХ — ОТДЕЛЬНО: tools/backfill_employee_city.js
--   (идемпотентно; --dry-run / --apply / --only-confidence).
--   Почему не в миграции: 43 записи требуют ручной проверки, 30 конфликтов
--   city↔адрес — решения человека, а 17 могут быть выведены только из места
--   рождения (не город проживания!) и требуют подтверждения.
--
-- CONSTRAINTS ЗДЕСЬ НЕТ НАМЕРЕННО.
--   Ограничение длины (CHECK chk_employees_city_length, 60 символов) добавляет
--   САМ БЭКФИЛЛ после успешной очистки (в БД есть адрес на 81 символ, который
--   иначе блокирует собственную правку). Раньше времени не ставим.
--
-- Потребители: src/lib/city.js (извлечение), src/routes/staff.js (sanitizeCity
--              при INSERT/PUT), tools/backfill_employee_city.js (разовый перенос).
-- Идемпотентно: ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.

-- ── 1. Колонки ──────────────────────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS city_legacy     character varying(255);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS city_source     character varying(32);
ALTER TABLE employees ADD COLUMN IF NOT EXISTS city_updated_at timestamp without time zone;

COMMENT ON COLUMN employees.city             IS 'ТОЛЬКО населённый пункт (Москва / Зерноград / пгт Красногорский). Полный адрес — в address / registration_address. См. V389.';
COMMENT ON COLUMN employees.city_legacy      IS 'Резервная копия employees.city до миграции V389 (аудит/откат).';
COMMENT ON COLUMN employees.city_source      IS 'Происхождение city: manual | address | registration_address | city | birth_place | migrated_v389.';
COMMENT ON COLUMN employees.city_updated_at  IS 'Когда city последний раз выведен из адреса (V389 backfill).';

-- ── 2. Резервная копия: снимок city на момент миграции ──────────────────────
-- Пишем ТОЛЬКО ОДИН РАЗ за всё время жизни БД, а не «пока city_legacy IS NULL».
-- Иначе повторный прогон файла (его гоняют вручную через psql -f, вне runner'а)
-- кладёт в снимок УЖЕ ОЧИЩЕННЫЙ city и безвозвратно теряет исходные адреса
-- (реальный дефект, найденный верификатором: повтор давал UPDATE 254).
-- Маркер однократности — строка в реестре migrations, которую пишет V389.
DO $$
DECLARE
  v_done boolean;
BEGIN
  CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    executed_at TIMESTAMP DEFAULT NOW()
  );

  SELECT EXISTS (SELECT 1 FROM migrations WHERE name = 'V389__employee_city_split')
    INTO v_done;

  IF NOT v_done THEN
    UPDATE employees
       SET city_legacy = city
     WHERE city IS NOT NULL
       AND btrim(city) <> '';
  END IF;
END $$;

-- ── 3. Индекс под фильтр «Город: все» (Personnel) и выгрузки ────────────────
CREATE INDEX IF NOT EXISTS idx_employees_city
  ON employees (city)
  WHERE city IS NOT NULL AND btrim(city) <> '';

-- ── 4. Маркер однократности (ДО правок города бэкфиллом!) ───────────────────
-- Порядок критичен: пока строки нет, снимок выше делает первый прогон;
-- бэкфилл при каждом запуске повторяет тот же `city_legacy = city`, и без
-- маркера он сбил бы снимок на уже очищенный город (реальная дыра, найдена
-- верификатором). Тот же маркер дублирует tools/backfill_employee_city.js.
INSERT INTO migrations (name) VALUES ('V389__employee_city_split')
ON CONFLICT (name) DO NOTHING;
