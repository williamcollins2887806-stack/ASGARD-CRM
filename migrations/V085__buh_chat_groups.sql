-- V085: BUH → chat_groups R/W
-- Missed in V083/V084. BUH was stable 403 on /api/chat-groups (messenger).
-- BUH coordinates with PM via messenger for payment confirmations.

INSERT INTO role_presets (role, module_key, can_read, can_write) VALUES
  ('BUH', 'chat_groups', true, true)
ON CONFLICT (role, module_key) DO UPDATE SET
  can_read  = EXCLUDED.can_read  OR role_presets.can_read,
  can_write = EXCLUDED.can_write OR role_presets.can_write;
