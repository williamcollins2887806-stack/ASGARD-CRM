-- =====================================================================
-- V254 DOWN — откатить расширение pk_v3_column до версии V250
-- =====================================================================

CREATE OR REPLACE FUNCTION pk_v3_column(flow_type TEXT, main_status TEXT)
RETURNS TEXT IMMUTABLE LANGUAGE sql AS $$
SELECT CASE
  WHEN flow_type='application' AND main_status IN ('new','ai_processed','under_review','assigned') THEN 'new'
  WHEN flow_type='application' AND main_status='accepted'                                          THEN 'calc'
  WHEN flow_type='application' AND main_status IN ('rejected','archived')                          THEN 'lose'
  WHEN flow_type='pre_tender' AND main_status IN ('new','need_docs')                               THEN 'new'
  WHEN flow_type='pre_tender' AND main_status='in_review'                                          THEN 'calc'
  WHEN flow_type='pre_tender' AND main_status='pending_approval'                                   THEN 'approval'
  WHEN flow_type='pre_tender' AND main_status='approved'                                           THEN 'kp_prep'
  WHEN flow_type='pre_tender' AND main_status IN ('rejected','expired')                            THEN 'lose'
  WHEN flow_type='tender' AND main_status IN ('Черновик','Новый','На анализе')                     THEN 'new'
  WHEN flow_type='tender' AND main_status IN ('Отправлено на просчёт','Согласование ТКП')          THEN 'calc'
  WHEN flow_type='tender' AND main_status='ТКП согласовано'                                        THEN 'approval'
  WHEN flow_type='tender' AND main_status='Готово к отправке КП'                                   THEN 'kp_prep'
  WHEN flow_type='tender' AND main_status='КП отправлено'                                          THEN 'sent'
  WHEN flow_type='tender' AND main_status='Дозапрос'                                               THEN 'addendum'
  WHEN flow_type='tender' AND main_status='Выиграли'                                               THEN 'win'
  WHEN flow_type='tender' AND main_status IN ('Проиграли','Не подходит')                           THEN 'lose'
  WHEN flow_type='work'                                                                            THEN 'work'
  ELSE 'new'
END
$$;

DROP INDEX IF EXISTS idx_pk_cards_v3_column;
CREATE INDEX idx_pk_cards_v3_column
  ON personal_kanban_cards (pk_v3_column(flow_type, current_main_status), owner_user_id)
  WHERE is_closed = FALSE;
