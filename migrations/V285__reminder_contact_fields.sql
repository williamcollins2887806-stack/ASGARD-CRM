-- V285: контактные поля для напоминаний о звонках / СМС
ALTER TABLE personal_kanban_card_reminders
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS contact_company TEXT;
