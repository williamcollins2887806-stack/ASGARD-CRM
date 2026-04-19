-- V064: Tender Tags — справочник тегов/групп тендеров
-- Замена текстового поля group_tag на нормализованный справочник

BEGIN;

-- 1. Таблица справочника тегов
CREATE TABLE IF NOT EXISTS tender_tags (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Seed данные (основные категории работ)
INSERT INTO tender_tags (name, sort_order) VALUES
  ('Промывка', 10),
  ('Монтаж', 20),
  ('Химия', 30),
  ('Гидромеханическая очистка', 40),
  ('Диагностика', 50),
  ('Пусконаладка', 60)
ON CONFLICT (name) DO NOTHING;

-- 3. Добавить существующие уникальные теги из tenders.group_tag (если не пустые и не совпадают с seed)
INSERT INTO tender_tags (name, sort_order)
SELECT DISTINCT TRIM(group_tag), 100
FROM tenders
WHERE group_tag IS NOT NULL
  AND TRIM(group_tag) <> ''
  AND TRIM(group_tag) NOT IN (SELECT name FROM tender_tags)
ON CONFLICT (name) DO NOTHING;

-- 4. Добавить FK колонку tag_id к tenders
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS tag_id INT REFERENCES tender_tags(id);

-- 5. Мигрировать существующие текстовые значения → tag_id
UPDATE tenders t
SET tag_id = tt.id
FROM tender_tags tt
WHERE TRIM(t.group_tag) = tt.name
  AND t.group_tag IS NOT NULL
  AND TRIM(t.group_tag) <> ''
  AND t.tag_id IS NULL;

COMMIT;
