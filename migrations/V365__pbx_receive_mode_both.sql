-- V365: receive_mode both (WebRTC + GSM cascade), default both for new operators

ALTER TABLE pbx_operators DROP CONSTRAINT IF EXISTS pbx_operators_receive_mode_check;
ALTER TABLE pbx_operators
  ADD CONSTRAINT pbx_operators_receive_mode_check
  CHECK (receive_mode IN ('browser', 'mobile', 'both'));

ALTER TABLE pbx_operators ALTER COLUMN receive_mode SET DEFAULT 'both';
