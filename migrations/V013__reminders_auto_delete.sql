-- ═══════════════════════════════════════════════════════════════════════════
-- V013: Автоудаление завершённых напоминаний
-- Дата: 2026-02-08
-- ═══════════════════════════════════════════════════════════════════════════

-- Добавляем колонки для отслеживания статуса напоминаний
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT false;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS dismissed BOOLEAN DEFAULT false;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMP;

-- Добавляем дополнительные поля для автонапоминаний
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS auto_key VARCHAR(100);
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal';
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'custom';
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE reminders ADD COLUMN IF NOT EXISTS due_time TIME;

-- Индекс для быстрого поиска напоминаний для удаления
CREATE INDEX IF NOT EXISTS idx_reminders_completed ON reminders(completed, completed_at) WHERE completed = true;

-- Индекс для автонапоминаний
CREATE INDEX IF NOT EXISTS idx_reminders_auto_key ON reminders(auto_key) WHERE auto_key IS NOT NULL;

-- Индекс для поиска по пользователю
CREATE INDEX IF NOT EXISTS idx_reminders_user_id ON reminders(user_id);
