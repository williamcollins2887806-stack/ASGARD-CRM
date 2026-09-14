-- V338: группа крови в анкете рабочего.
-- PUT /api/field/worker/personal падал 500: value too long for varchar(10)
-- (например «AB(IV) Rh+» = 11 символов). clothing/shoe — повторно расширяем
-- на случай, если V217/V290 не доехали до конкретной колонки.

ALTER TABLE employees
  ALTER COLUMN blood_type TYPE VARCHAR(40);

ALTER TABLE employees
  ALTER COLUMN clothing_size TYPE VARCHAR(30);

ALTER TABLE employees
  ALTER COLUMN shoe_size TYPE VARCHAR(20);
