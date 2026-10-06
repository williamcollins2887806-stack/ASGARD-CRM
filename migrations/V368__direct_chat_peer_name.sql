-- Direct chats: display name = peer only (legacy was "Me — Peer").
-- Second segment of " — " separator matches peer name in historical rows.

UPDATE chats
SET name = trim(both FROM split_part(name, ' — ', 2))
WHERE type = 'direct'
  AND COALESCE(is_group, false) = false
  AND name LIKE '% — %'
  AND length(trim(both FROM split_part(name, ' — ', 2))) > 0;
