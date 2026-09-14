-- V307: Fix face_paint wrongly stored in active_badge; clear corrupted badge slots

UPDATE employees
SET active_badge = NULL
WHERE active_badge ILIKE '%раскраск%'
   OR active_badge ILIKE '%краск%'
   OR active_badge ILIKE 'paint_%';
