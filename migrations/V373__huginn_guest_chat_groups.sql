-- V373: Huginn guest → chat_groups R/W.
--
-- Root cause of «на мобильном нет чатов»: /h/ guests carry role `huginn_guest`
-- in the JWT, but GET /api/chat-groups is gated by requirePermission('chat_groups')
-- and no migration ever granted it for that role → 403 → loadChats() failed →
-- mount() aborted → empty screen. Guests have no CRM role, so role_presets was
-- never populated for them.
--
-- Guest isolation is preserved by huginn-acl.js, which limits guests to the
-- messenger API surface (chat-groups/stories/push/auth/sse) and denies
-- mimir/estimate CRMs bridges. This preset only opens the messenger module.
INSERT INTO role_presets (role, module_key, can_read, can_write) VALUES
  ('huginn_guest', 'chat_groups', true, true)
ON CONFLICT (role, module_key) DO UPDATE SET
  can_read  = EXCLUDED.can_read  OR role_presets.can_read,
  can_write = EXCLUDED.can_write OR role_presets.can_write;
