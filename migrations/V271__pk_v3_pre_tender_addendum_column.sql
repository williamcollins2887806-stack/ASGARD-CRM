-- V271 — pre_tender: колонка «Дозапрос» + новый порядок этапов канбана
-- Целевой flow: calc → addendum → kp_prep → approval → sent

-- Новый статус addendum для pre_tender
ALTER TABLE pre_tender_requests DROP CONSTRAINT IF EXISTS pre_tender_requests_status_check;
ALTER TABLE pre_tender_requests ADD CONSTRAINT pre_tender_requests_status_check
  CHECK (status IN ('new','in_review','need_docs','addendum','accepted','rejected','expired',
                    'pending_approval','approved','pending_payment','paid','cash_issued',
                    'cash_received','expense_reported'));

CREATE OR REPLACE FUNCTION pk_v3_column(flow_type TEXT, main_status TEXT)
RETURNS TEXT IMMUTABLE LANGUAGE sql AS $$
SELECT CASE
  WHEN flow_type='application' AND main_status IN ('new','ai_processed','under_review','assigned') THEN 'new'
  WHEN flow_type='application' AND main_status='accepted'                                          THEN 'calc'
  WHEN flow_type='application' AND main_status IN ('rejected','archived')                          THEN 'lose'
  -- pre_tender: calc → addendum → kp_prep → approval → sent (V271)
  WHEN flow_type='pre_tender' AND main_status IN ('new','need_docs')                               THEN 'new'
  WHEN flow_type='pre_tender' AND main_status='in_review'                                          THEN 'calc'
  WHEN flow_type='pre_tender' AND main_status='addendum'                                           THEN 'addendum'
  WHEN flow_type='pre_tender' AND main_status IN ('approved','accepted')                           THEN 'kp_prep'
  WHEN flow_type='pre_tender' AND main_status='pending_approval'                                   THEN 'approval'
  WHEN flow_type='pre_tender' AND main_status='pending_payment'                                    THEN 'sent'
  WHEN flow_type='pre_tender' AND main_status='paid'                                               THEN 'win'
  WHEN flow_type='pre_tender' AND main_status IN ('cash_issued','cash_received','expense_reported') THEN 'work'
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
