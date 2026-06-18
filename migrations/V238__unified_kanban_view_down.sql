-- V238 DOWN: откат VIEW и функции

DROP INDEX IF EXISTS idx_pk_cards_v3_column;
DROP VIEW IF EXISTS v_unified_kanban_cards;
DROP FUNCTION IF EXISTS pk_v3_column(TEXT, TEXT);
