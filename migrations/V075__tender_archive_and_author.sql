-- V075: Архив тендеров (статус "Не подходит") + изменение автора
-- Утверждено 12.04.2026

-- 1. Новые колонки для архива
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS archived_at TIMESTAMP;
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS archived_by INTEGER REFERENCES users(id);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS archive_reason VARCHAR(100);
ALTER TABLE tenders ADD COLUMN IF NOT EXISTS archive_comment TEXT;

-- 2. Индекс по архивированным (для быстрой фильтрации)
CREATE INDEX IF NOT EXISTS idx_tenders_archived ON tenders (archived_at) WHERE archived_at IS NOT NULL;

-- 3. Лог изменения автора (отдельная таблица для истории)
CREATE TABLE IF NOT EXISTS tender_author_history (
  id SERIAL PRIMARY KEY,
  tender_id INTEGER NOT NULL REFERENCES tenders(id),
  old_author_id INTEGER REFERENCES users(id),
  new_author_id INTEGER REFERENCES users(id),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tender_author_history_tender ON tender_author_history (tender_id);

-- 4. Обновить статусы — добавить "Не подходит" как допустимый
-- (статусы хранятся как VARCHAR, новый статус просто используется)
COMMENT ON COLUMN tenders.archive_reason IS '15 категорий: Не наш профиль, Нет ресурсов, Срок истёк, Нерентабельно, Далеко, Мало информации, Заказчик ненадёжный, Высокая конкуренция, Не прошли квалификацию, Заказчик отменил, Дублирует другой, Малый объём, Требуются допуски, Невыгодные условия, Другое';
