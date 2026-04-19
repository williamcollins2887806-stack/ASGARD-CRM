-- V084: Final missing permissions — BUH/cash + DIRECTOR_COMM + TO/OM chat_groups
-- Discovered in final console-audit run after V083 (2026-04-19)
-- BUH was completely blocked from cash/cash-admin (hidden gap — /cash-admin not in audit PAGES)

INSERT INTO role_presets (role, module_key, can_read, can_write) VALUES
  ('DIRECTOR_COMM',  'cash',        true, false),
  ('DIRECTOR_COMM',  'cash_admin',  true, false),
  ('BUH',            'cash',        true, false),
  ('BUH',            'cash_admin',  true, true),
  ('TO',             'chat_groups', true, true),
  ('OFFICE_MANAGER', 'chat_groups', true, true)
ON CONFLICT (role, module_key) DO UPDATE SET
  can_read  = EXCLUDED.can_read  OR role_presets.can_read,
  can_write = EXCLUDED.can_write OR role_presets.can_write;
