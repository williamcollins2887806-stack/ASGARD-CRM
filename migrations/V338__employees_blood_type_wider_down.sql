ALTER TABLE employees
  ALTER COLUMN blood_type TYPE VARCHAR(10)
  USING left(blood_type, 10);

ALTER TABLE employees
  ALTER COLUMN clothing_size TYPE VARCHAR(30);

ALTER TABLE employees
  ALTER COLUMN shoe_size TYPE VARCHAR(20);
