-- V382: Комментарии/вложения — на уровень ЗАДАЧИ (пункта), а не чекпоинта.
-- Раньше: одна заметка на каждый шаг. Теперь: один блок комментариев на карточку задачи.
-- checkpoint_id сохраняем как необязательную ссылку (обратная совместимость), добавляем item_id.

ALTER TABLE dev_roadmap_comments
  ADD COLUMN IF NOT EXISTS item_id BIGINT REFERENCES dev_roadmap_items(id) ON DELETE CASCADE;

-- Бэкфилл: у существующих комментариев берём задачу их чекпоинта.
UPDATE dev_roadmap_comments c
   SET item_id = cp.item_id
  FROM dev_roadmap_checkpoints cp
 WHERE c.checkpoint_id = cp.id
   AND c.item_id IS NULL;

-- Чекпоинт больше не обязателен.
ALTER TABLE dev_roadmap_comments ALTER COLUMN checkpoint_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dev_roadmap_comments_item
  ON dev_roadmap_comments (item_id, created_at);
