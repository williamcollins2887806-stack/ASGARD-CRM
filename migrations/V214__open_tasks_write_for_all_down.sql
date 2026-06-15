-- V214 DOWN — откат tasks:write для BUH (восстанавливаем как было).
UPDATE role_presets SET can_write = false WHERE module_key = 'tasks' AND role = 'BUH';
