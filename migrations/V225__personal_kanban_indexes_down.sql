-- V225 down: убрать индексы канбана.
DROP INDEX IF EXISTS idx_pk_cards_owner_open;
DROP INDEX IF EXISTS idx_pk_cards_substage_active;
