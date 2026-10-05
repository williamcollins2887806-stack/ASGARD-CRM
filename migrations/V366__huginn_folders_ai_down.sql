-- Down: V366 huginn folders + AI editor
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_huginn_active_folder_id_fkey;
ALTER TABLE users DROP COLUMN IF EXISTS huginn_active_folder_id;
DROP TABLE IF EXISTS huginn_ai_editor_log;
DROP TABLE IF EXISTS huginn_ai_styles;
DROP TABLE IF EXISTS huginn_chat_folder_members;
DROP TABLE IF EXISTS huginn_chat_folders;
