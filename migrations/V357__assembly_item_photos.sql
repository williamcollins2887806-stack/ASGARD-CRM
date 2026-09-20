-- V357: Фото позиции сборки (перенос функции из legacy field_packing → assembly).
-- Зачем: при сборке рабочий фиксирует фото позиции (подтверждение комплектности).
-- В legacy-контуре поле жило в field_packing_items.photo_filename/photo_original/
-- photographed_at/photographed_by. Переносим в assembly_items (миграция, а не дроп legacy —
-- legacy-таблицы остаются нетронутыми для истории).
-- Идемпотентно (ADD COLUMN IF NOT EXISTS).

ALTER TABLE assembly_items ADD COLUMN IF NOT EXISTS photo_filename VARCHAR(300);
ALTER TABLE assembly_items ADD COLUMN IF NOT EXISTS photo_original VARCHAR(300);
ALTER TABLE assembly_items ADD COLUMN IF NOT EXISTS photographed_at TIMESTAMP;
ALTER TABLE assembly_items ADD COLUMN IF NOT EXISTS photographed_by INTEGER REFERENCES users(id);
