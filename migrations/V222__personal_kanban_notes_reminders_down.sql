-- V222 down: убрать заметки и напоминания (история уйдёт каскадом по card_id).
DROP TABLE IF EXISTS personal_kanban_card_reminders;
DROP TABLE IF EXISTS personal_kanban_card_notes;
