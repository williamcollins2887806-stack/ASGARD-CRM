-- V372: Huginn presence — honest last-seen backfill.
--
-- `users.last_seen_at` was added with no default (V364), so pre-existing rows are
-- NULL and read as «не в сети» forever until the user's first presence ping.
-- Presence is now derived ONLY from last_seen_at freshness (socket model removed),
-- so every active user needs a sane value. Seed from last_login_at when present,
-- otherwise created_at, so nobody shows as «never» due to a missing baseline.
UPDATE users
   SET last_seen_at = COALESCE(last_seen_at, last_login_at, created_at)
 WHERE last_seen_at IS NULL;
