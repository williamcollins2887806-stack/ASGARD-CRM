-- Откат V229
ALTER TABLE chats DROP CONSTRAINT IF EXISTS chats_group_kind_check;
ALTER TABLE chats DROP COLUMN IF EXISTS group_kind;
