-- V382 down: вернуть комментарии на уровень чекпоинта
DROP INDEX IF EXISTS idx_dev_roadmap_comments_item;
ALTER TABLE dev_roadmap_comments DROP COLUMN IF EXISTS item_id;
