-- V373 down: revoke the guest messenger grant.
DELETE FROM role_presets WHERE role = 'huginn_guest' AND module_key = 'chat_groups';
