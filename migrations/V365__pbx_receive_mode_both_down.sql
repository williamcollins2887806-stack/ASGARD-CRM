ALTER TABLE pbx_operators DROP CONSTRAINT IF EXISTS pbx_operators_receive_mode_check;
UPDATE pbx_operators SET receive_mode = 'browser' WHERE receive_mode = 'both';
ALTER TABLE pbx_operators
  ADD CONSTRAINT pbx_operators_receive_mode_check
  CHECK (receive_mode IN ('browser', 'mobile'));
ALTER TABLE pbx_operators ALTER COLUMN receive_mode SET DEFAULT 'browser';
