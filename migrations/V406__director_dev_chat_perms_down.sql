-- V406 down: вернуть DIRECTOR_DEV к состоянию до выдачи chat_groups/tasks.
-- tasks у DIRECTOR_DEV остаётся (он был выдан ранее); убираем только chat_groups.
DELETE FROM role_presets
 WHERE role = 'DIRECTOR_DEV' AND module_key = 'chat_groups';
