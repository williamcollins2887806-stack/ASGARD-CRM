-- V321 down: drop MLSP stay tables and inbound_transport column

DROP TABLE IF EXISTS mlsp_stay_events;
DROP TABLE IF EXISTS mlsp_stays;

ALTER TABLE employee_planned_engagements
  DROP COLUMN IF EXISTS inbound_transport;

DELETE FROM settings WHERE key = 'mlsp_stay_notify_user_ids';
