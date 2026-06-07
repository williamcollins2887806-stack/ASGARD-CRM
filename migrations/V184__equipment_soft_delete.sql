-- V184: мягкое удаление для equipment + индекс.
-- Нужно, чтобы перенесённые в Каталог-расходники позиции уходили с вкладки «Оборудование»,
-- но не терялись (история, возможность вернуть). В equipment не было deleted_at — только is_active/status.
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_equipment_deleted_at ON equipment(deleted_at) WHERE deleted_at IS NULL;
