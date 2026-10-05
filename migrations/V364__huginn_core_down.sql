-- Down: Huginn core (non-destructive preferred — drop only huginn-owned tables)
DROP TABLE IF EXISTS huginn_invites;
DROP TABLE IF EXISTS chat_stickers;
DROP TABLE IF EXISTS chat_sticker_packs;
DROP TABLE IF EXISTS chat_story_views;
DROP TABLE IF EXISTS chat_voice_jobs;
DROP TABLE IF EXISTS huginn_events;
DROP TABLE IF EXISTS chat_message_reads;
-- columns on users / user_stories / thing_rooms left in place (safe)
