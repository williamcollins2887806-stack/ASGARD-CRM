-- V083: Grant missing permissions for chat_groups/cash + cleanup dead todo module
-- Session 2026-04-19 console-audit cleanup

-- Часть 1: выдача прав по обнаруженным 403
INSERT INTO role_presets (role, module_key, can_read, can_write) VALUES
  ('PM',            'cash',        true, false),
  ('DIRECTOR_COMM', 'chat_groups', true, true),
  ('HEAD_TO',       'chat_groups', true, true),
  ('HR',            'chat_groups', true, true),
  ('WAREHOUSE',     'chat_groups', true, true),
  ('PROC',          'chat_groups', true, true)
ON CONFLICT (role, module_key) DO UPDATE SET
  can_read = EXCLUDED.can_read OR role_presets.can_read,
  can_write = EXCLUDED.can_write OR role_presets.can_write;

-- Часть 2: очистка мёртвого module_key='todo'
-- (endpoints переведены на 'tasks' в refactor ea5c5c8)

DELETE FROM role_presets WHERE module_key = 'todo';
