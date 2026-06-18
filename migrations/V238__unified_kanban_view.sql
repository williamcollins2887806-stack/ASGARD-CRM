-- V238__unified_kanban_view.sql
-- Wave 1, v3 канбан: VIEW для 8-колоночного агрегата + функция маппинга

-- Функция маппинга (flow_type, main_status) → 8 каноничных колонок v3
CREATE OR REPLACE FUNCTION pk_v3_column(flow_type TEXT, main_status TEXT)
RETURNS TEXT IMMUTABLE LANGUAGE sql AS $$
SELECT CASE
  -- application (входящая заявка)
  WHEN flow_type='application' AND main_status IN ('new','ai_processed','under_review','assigned') THEN 'new'
  WHEN flow_type='application' AND main_status='accepted'                                          THEN 'calc'
  WHEN flow_type='application' AND main_status IN ('rejected','archived')                          THEN 'lose'
  -- pre_tender (просчёт)
  WHEN flow_type='pre_tender' AND main_status IN ('new','need_docs')                               THEN 'new'
  WHEN flow_type='pre_tender' AND main_status='in_review'                                          THEN 'calc'
  WHEN flow_type='pre_tender' AND main_status='pending_approval'                                   THEN 'approval'
  WHEN flow_type='pre_tender' AND main_status='approved'                                           THEN 'kp_prep'
  WHEN flow_type='pre_tender' AND main_status IN ('rejected','expired')                            THEN 'lose'
  -- tender
  WHEN flow_type='tender' AND main_status IN ('Черновик','Новый','На анализе')                     THEN 'new'
  WHEN flow_type='tender' AND main_status IN ('Отправлено на просчёт','Согласование ТКП')          THEN 'calc'
  WHEN flow_type='tender' AND main_status='ТКП согласовано'                                        THEN 'approval'
  WHEN flow_type='tender' AND main_status='Готово к отправке КП'                                   THEN 'kp_prep'
  WHEN flow_type='tender' AND main_status='КП отправлено'                                          THEN 'sent'
  WHEN flow_type='tender' AND main_status='Выиграли'                                               THEN 'win'
  WHEN flow_type='tender' AND main_status IN ('Проиграли','Не подходит')                           THEN 'lose'
  -- work
  WHEN flow_type='work'                                                                            THEN 'work'
  ELSE 'new'
END
$$;

-- VIEW: единый агрегат для рендера 8-колоночного канбана
CREATE OR REPLACE VIEW v_unified_kanban_cards AS
SELECT
  c.id,
  c.owner_user_id,
  c.flow_type,
  c.entity_kind,
  c.entity_id,
  c.current_main_status,
  c.current_substage_id,
  c.is_closed,
  c.version,
  c.last_moved_at,
  c.created_at,
  c.updated_at,
  pk_v3_column(c.flow_type, c.current_main_status) AS v3_column,
  s.title       AS substage_title,
  s.color       AS substage_color,
  s.sort_order  AS substage_sort_order
FROM personal_kanban_cards c
LEFT JOIN kanban_substages s ON s.id = c.current_substage_id;

-- Функциональный индекс для фильтра v3_column=X (быстро)
CREATE INDEX IF NOT EXISTS idx_pk_cards_v3_column
  ON personal_kanban_cards (pk_v3_column(flow_type, current_main_status), owner_user_id)
  WHERE is_closed = FALSE;
