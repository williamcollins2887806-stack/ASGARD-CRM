-- Migration: add dispatcher/push columns to user_call_status
ALTER TABLE user_call_status ADD COLUMN IF NOT EXISTS receive_call_push BOOLEAN DEFAULT false;
ALTER TABLE user_call_status ADD COLUMN IF NOT EXISTS is_call_dispatcher BOOLEAN DEFAULT false;
