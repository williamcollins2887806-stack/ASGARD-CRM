-- V411 down: откат графика отпусков офиса.
-- DROP только тех строк role_presets, что создал up (module_key='vacations').

DELETE FROM role_presets WHERE module_key = 'vacations';

DROP TABLE IF EXISTS office_vacation_periods;
DROP TABLE IF EXISTS office_vacation_audit;
DROP TABLE IF EXISTS office_vacation_reminders;
DROP TABLE IF EXISTS office_vacation_blocked_days;
DROP TABLE IF EXISTS office_vacation_days;
DROP TABLE IF EXISTS office_vacation_approvals;
DROP TABLE IF EXISTS office_vacations;
