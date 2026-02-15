-- ASGARD CRM — Исправление таблицы seal_transfers
-- Добавление недостающих колонок для корректной работы модуля печатей
-- ═══════════════════════════════════════════════════════════════════════════════

-- Колонки, используемые в seals.js но отсутствующие в схеме

-- Идентификаторы пользователей (from_id/to_id vs from_user_id/to_user_id)
ALTER TABLE seal_transfers ADD COLUMN IF NOT EXISTS from_id INTEGER;
ALTER TABLE seal_transfers ADD COLUMN IF NOT EXISTS to_id INTEGER;

-- Возврат и бессрочность
ALTER TABLE seal_transfers ADD COLUMN IF NOT EXISTS return_date DATE;
ALTER TABLE seal_transfers ADD COLUMN IF NOT EXISTS is_indefinite BOOLEAN DEFAULT false;

-- Цель передачи (КРИТИЧНО - эта колонка отсутствовала!)
ALTER TABLE seal_transfers ADD COLUMN IF NOT EXISTS purpose TEXT;

-- Статус передачи (pending/confirmed)
ALTER TABLE seal_transfers ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'pending';

-- Кто создал запись
ALTER TABLE seal_transfers ADD COLUMN IF NOT EXISTS created_by INTEGER;

-- Дата подтверждения
ALTER TABLE seal_transfers ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP;

-- Кто подтвердил
ALTER TABLE seal_transfers ADD COLUMN IF NOT EXISTS approved_by INTEGER;
ALTER TABLE seal_transfers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP;

-- Комментарий (альтернатива notes)
ALTER TABLE seal_transfers ADD COLUMN IF NOT EXISTS comment TEXT;

-- Дополнительные колонки для seals таблицы
ALTER TABLE seals ADD COLUMN IF NOT EXISTS type VARCHAR(50);
ALTER TABLE seals ADD COLUMN IF NOT EXISTS inv_number VARCHAR(100);
ALTER TABLE seals ADD COLUMN IF NOT EXISTS purchase_date DATE;
ALTER TABLE seals ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE seals ADD COLUMN IF NOT EXISTS holder_id INTEGER;
ALTER TABLE seals ADD COLUMN IF NOT EXISTS return_date DATE;
ALTER TABLE seals ADD COLUMN IF NOT EXISTS is_indefinite BOOLEAN DEFAULT false;
ALTER TABLE seals ADD COLUMN IF NOT EXISTS pending_transfer_id INTEGER;

-- Индексы
CREATE INDEX IF NOT EXISTS idx_seal_transfers_seal ON seal_transfers(seal_id);
CREATE INDEX IF NOT EXISTS idx_seal_transfers_status ON seal_transfers(status);
CREATE INDEX IF NOT EXISTS idx_seals_holder ON seals(holder_id);
CREATE INDEX IF NOT EXISTS idx_seals_status ON seals(status);

SELECT 'seal_transfers и seals таблицы обновлены!' as result;
