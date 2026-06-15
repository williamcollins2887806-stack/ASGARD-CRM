-- V214: открыть tasks:write для всех ролей.
-- Контекст: help-задачи (V212) — любой → любому. До V214 BUH имел tasks:write=false
-- в role_presets, что блокировало им создание help-задач + accept/complete и др.
-- (если они становились исполнителями).
-- Безопасно: только UPDATE на role_presets, никакого влияния на старые директивы
-- (директивы блокируются ВНУТРИ кода по DIRECTOR_ROLES, не по permission).
UPDATE role_presets SET can_write = true WHERE module_key = 'tasks' AND can_write = false;

-- Гарантия что нет ролей с tasks:read=false (sanity check)
UPDATE role_presets SET can_read = true WHERE module_key = 'tasks' AND can_read = false;
