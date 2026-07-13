-- V289: размер головного убора (каска) в анкете рабочего
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS headwear_size VARCHAR(20);

COMMENT ON COLUMN employees.headwear_size IS 'Размер головного убора (каска / каскетка)';
