-- V221 down: убрать таблицы канбана. История стирается каскадом.
DROP TABLE IF EXISTS personal_kanban_card_history;
DROP TABLE IF EXISTS personal_kanban_cards;
DROP TABLE IF EXISTS kanban_substages;
