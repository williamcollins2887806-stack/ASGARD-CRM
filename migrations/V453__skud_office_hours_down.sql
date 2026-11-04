-- Rollback V453: учёт часов офиса по СКУД + серверный учёт времени СРМ.
-- Настройки 'skud' удаляются — они целиком принадлежат этому контуру.

DROP TABLE IF EXISTS crm_activity_token;
DROP TABLE IF EXISTS office_presence_flags;
DROP TABLE IF EXISTS office_hours_daily;
DROP TABLE IF EXISTS skud_person_map;
DROP TABLE IF EXISTS skud_punches;
DROP TABLE IF EXISTS skud_imports;

DELETE FROM settings WHERE key = 'skud';
