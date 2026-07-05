-- V274: касса подотчётника для HEAD_TO (Хосе) — доступ к модулю cash.
INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('HEAD_TO', 'cash', true, true, false)
ON CONFLICT (role, module_key) DO UPDATE SET
  can_read  = EXCLUDED.can_read  OR role_presets.can_read,
  can_write = EXCLUDED.can_write OR role_presets.can_write;
