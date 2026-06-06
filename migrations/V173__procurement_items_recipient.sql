-- V163: Распределённая приёмка одной поставки по нескольким получателям.
-- Пример: приехало 100 пар перчаток = 50 проекту А, 30 проекту Б, 20 на склад.
-- recipient_kind: project (под конкретную работу/объект) | warehouse (на склад).
-- recipient_work_id — под какую работу (если project).
-- product_id уже добавлен в V153 (закупки) — здесь НЕ дублируем.

ALTER TABLE procurement_items
  ADD COLUMN IF NOT EXISTS recipient_kind    VARCHAR(20)
                            CHECK (recipient_kind IS NULL OR recipient_kind IN ('project','warehouse')),
  ADD COLUMN IF NOT EXISTS recipient_work_id INTEGER REFERENCES works(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_proc_items_recipient_work ON procurement_items(recipient_work_id) WHERE recipient_work_id IS NOT NULL;
