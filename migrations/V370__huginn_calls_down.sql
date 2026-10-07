-- Rollback for V370 (huginn_calls + chats.is_favorite).
DROP INDEX IF EXISTS idx_huginn_calls_chat;
DROP INDEX IF EXISTS idx_huginn_calls_caller_status;
DROP INDEX IF EXISTS idx_huginn_calls_callee_status;
DROP TABLE IF EXISTS huginn_calls;
ALTER TABLE chats DROP COLUMN IF EXISTS is_favorite;
