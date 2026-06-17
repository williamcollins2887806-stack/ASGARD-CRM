-- V225: дополнительные индексы под производительность личного канбана.
--
-- idx_pk_cards_substage_active — быстрый GROUP BY substage по открытым картам
-- (выборка списка карт под колонку «substage X из main_status Y»).
-- idx_pk_cards_owner_open — индикатор зависания (sort by last_moved_at для open-карт).

CREATE INDEX IF NOT EXISTS idx_pk_cards_substage_active
  ON personal_kanban_cards(current_substage_id)
  WHERE is_closed = FALSE;

CREATE INDEX IF NOT EXISTS idx_pk_cards_owner_open
  ON personal_kanban_cards(owner_user_id, last_moved_at)
  WHERE is_closed = FALSE;
