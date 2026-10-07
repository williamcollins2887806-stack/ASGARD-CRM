-- Direct chats with a BOT member (Мимир): display name must be the BOT's name,
-- not the human's own name. V368 (split "A — B") left these as the human's name,
-- which leaks the viewer's own ФИО as the chat title.
UPDATE chats c
SET name = b.name
FROM chat_group_members m
JOIN users b ON b.id = m.user_id AND b.role = 'BOT'
WHERE m.chat_id = c.id
  AND c.type = 'direct'
  AND COALESCE(c.is_group, false) = false
  AND c.name IS DISTINCT FROM b.name;
