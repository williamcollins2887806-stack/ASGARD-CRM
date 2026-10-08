-- V375 down: вернуть дефолт receive_mode 'both' (как в V365).
ALTER TABLE pbx_operators ALTER COLUMN receive_mode SET DEFAULT 'both';
