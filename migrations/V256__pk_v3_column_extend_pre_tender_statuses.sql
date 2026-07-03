-- =====================================================================
-- V256 — pk_v3_column: расширение покрытия pre_tender статусов
-- (был V254, переименован — V254 занят иконотекой склада, V255 этапом «Корабль»)
-- =====================================================================
-- Дата: 23.06.2026
-- Источник проблемы: PreTenders audit D-2.
--
-- ПРОБЛЕМА:
-- В V250 функция pk_v3_column() для flow_type='pre_tender' покрывает только
-- 7 статусов: new/need_docs → 'new', in_review → 'calc', pending_approval →
-- 'approval', approved → 'kp_prep', rejected/expired → 'lose'.
-- Остальные 6 значений status_v2 (accepted, pending_payment, paid,
-- cash_issued, cash_received, expense_reported) попадают в ELSE → 'new'.
-- Эффект: оплаченная заявка, по которой уже работают рабочие, остаётся
-- видна в первой колонке канбана «📥 Новые», создавая иллюзию что её надо
-- распределять.
--
-- РЕШЕНИЕ (согласовано с юзером 23.06.2026):
--   accepted          → kp_prep  (принято, готовим КП)
--   pending_payment   → sent     (КП отправлено, ждём оплату)
--   paid              → win      (оплачено = выиграли)
--   cash_issued       → work     (наличные выданы, рабочая фаза)
--   cash_received     → work     (наличные получены)
--   expense_reported  → work     (расходы отчитаны)
-- =====================================================================

CREATE OR REPLACE FUNCTION pk_v3_column(flow_type TEXT, main_status TEXT)
RETURNS TEXT IMMUTABLE LANGUAGE sql AS $$
SELECT CASE
  -- application (входящая заявка)
  WHEN flow_type='application' AND main_status IN ('new','ai_processed','under_review','assigned') THEN 'new'
  WHEN flow_type='application' AND main_status='accepted'                                          THEN 'calc'
  WHEN flow_type='application' AND main_status IN ('rejected','archived')                          THEN 'lose'
  -- pre_tender (просчёт) — V254 расширено
  WHEN flow_type='pre_tender' AND main_status IN ('new','need_docs')                               THEN 'new'
  WHEN flow_type='pre_tender' AND main_status='in_review'                                          THEN 'calc'
  WHEN flow_type='pre_tender' AND main_status='pending_approval'                                   THEN 'approval'
  WHEN flow_type='pre_tender' AND main_status IN ('approved','accepted')                           THEN 'kp_prep'   -- V254
  WHEN flow_type='pre_tender' AND main_status='pending_payment'                                    THEN 'sent'      -- V254
  WHEN flow_type='pre_tender' AND main_status='paid'                                               THEN 'win'       -- V254
  WHEN flow_type='pre_tender' AND main_status IN ('cash_issued','cash_received','expense_reported') THEN 'work'      -- V254
  WHEN flow_type='pre_tender' AND main_status IN ('rejected','expired')                            THEN 'lose'
  -- tender
  WHEN flow_type='tender' AND main_status IN ('Черновик','Новый','На анализе')                     THEN 'new'
  WHEN flow_type='tender' AND main_status IN ('Отправлено на просчёт','Согласование ТКП')          THEN 'calc'
  WHEN flow_type='tender' AND main_status='ТКП согласовано'                                        THEN 'approval'
  WHEN flow_type='tender' AND main_status='Готово к отправке КП'                                   THEN 'kp_prep'
  WHEN flow_type='tender' AND main_status='КП отправлено'                                          THEN 'sent'
  WHEN flow_type='tender' AND main_status='Дозапрос'                                               THEN 'addendum'
  WHEN flow_type='tender' AND main_status='Выиграли'                                               THEN 'win'
  WHEN flow_type='tender' AND main_status IN ('Проиграли','Не подходит')                           THEN 'lose'
  -- work
  WHEN flow_type='work'                                                                            THEN 'work'
  ELSE 'new'
END
$$;

-- PostgreSQL НЕ пересчитывает функциональные индексы при CREATE OR REPLACE
-- тела IMMUTABLE-функции. Пересоздаём индекс, чтобы карточки с обновлёнными
-- статусами реально попали в свои новые колонки при выборке через индекс.
DROP INDEX IF EXISTS idx_pk_cards_v3_column;
CREATE INDEX idx_pk_cards_v3_column
  ON personal_kanban_cards (pk_v3_column(flow_type, current_main_status), owner_user_id)
  WHERE is_closed = FALSE;
