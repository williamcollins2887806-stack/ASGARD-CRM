-- ═══════════════════════════════════════════════════════════════════════
-- V026: Расширение таблицы correspondence + связь с emails
-- ═══════════════════════════════════════════════════════════════════════

-- Добавляем недостающие колонки (correspondence.js уже использует их через generic API)
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS number VARCHAR(50);
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS date DATE;
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS doc_type VARCHAR(30) DEFAULT 'letter';
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS counterparty VARCHAR(255);
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS contact_person VARCHAR(255);
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS note TEXT;

-- Связь с таблицей emails (для автоматически созданных записей)
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS email_id INTEGER REFERENCES emails(id) ON DELETE SET NULL;

-- Связь с тендером и работой (уже есть tender_id, work_id — добавляем customer_id)
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS customer_id INTEGER;

-- Статус корреспонденции
ALTER TABLE correspondence ADD COLUMN IF NOT EXISTS status VARCHAR(30) DEFAULT 'registered';
-- Статусы: registered (зарегистрировано), sent (отправлено), delivered (доставлено),
--           answered (получен ответ), closed (закрыто)

-- Серверный счётчик для ИСХ-номеров (гарантирует уникальность)
CREATE SEQUENCE IF NOT EXISTS correspondence_outgoing_seq START 1;

-- Уникальный индекс на номер внутри года
CREATE UNIQUE INDEX IF NOT EXISTS idx_correspondence_number
  ON correspondence(number) WHERE number IS NOT NULL AND number != '';

-- Индекс на email_id для быстрого поиска
CREATE INDEX IF NOT EXISTS idx_correspondence_email_id ON correspondence(email_id);

-- Индекс на дату для фильтрации по годам
CREATE INDEX IF NOT EXISTS idx_correspondence_date ON correspondence(date);
