-- V290: расширить clothing_size — в Excel встречаются «46-48 (S-M)», 10 символов мало
ALTER TABLE employees
  ALTER COLUMN clothing_size TYPE VARCHAR(30);
