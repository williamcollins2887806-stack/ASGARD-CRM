-- V486 down: убрать телеметрию Тинга
BEGIN;

DROP VIEW IF EXISTS thing_room_quality;
DROP TABLE IF EXISTS thing_client_metrics;

COMMIT;
