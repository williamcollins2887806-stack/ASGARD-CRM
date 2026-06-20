-- V250 DOWN: откат миграции «Дозапрос + addendum + source_kind».
--
-- Откат в обратном порядке:
--   1. Восстановить pk_v3_column до состояния V238 (без 'Дозапрос'→'addendum')
--   2. Пересоздать функциональный индекс idx_pk_cards_v3_column
--   3. Удалить CHECK tenders_source_kind_check
--   4. Удалить индекс idx_tenders_source_kind
--   5. Удалить колонку tenders.source_kind
--
-- ⚠ Существующие карты `personal_kanban_cards` со `current_main_status='Дозапрос'`
-- после отката будут попадать в fallback 'new' колонку (как в V238). Данные
-- не теряются, но visual position на канбане сменится. Это ожидаемое поведение
-- для отката.

-- ────────────────────────────────────────────────────────────────────
-- 1. Восстановить pk_v3_column до V238 — без новой строки 'Дозапрос'.
--    Тело функции — точная копия V238__unified_kanban_view.sql.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pk_v3_column(flow_type TEXT, main_status TEXT)
RETURNS TEXT IMMUTABLE LANGUAGE sql AS $$
SELECT CASE
  -- application
  WHEN flow_type='application' AND main_status IN ('new','ai_processed','under_review','assigned') THEN 'new'
  WHEN flow_type='application' AND main_status='accepted'                                          THEN 'calc'
  WHEN flow_type='application' AND main_status IN ('rejected','archived')                          THEN 'lose'
  -- pre_tender
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

-- ────────────────────────────────────────────────────────────────────
-- 2. Пересоздать функциональный индекс после CREATE OR REPLACE FUNCTION.
-- ────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_pk_cards_v3_column;
CREATE INDEX idx_pk_cards_v3_column
  ON personal_kanban_cards (pk_v3_column(flow_type, current_main_status), owner_user_id)
  WHERE is_closed = FALSE;

-- ────────────────────────────────────────────────────────────────────
-- 3. Удалить CHECK на source_kind (если есть).
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE tenders DROP CONSTRAINT IF EXISTS tenders_source_kind_check;

-- ────────────────────────────────────────────────────────────────────
-- 4. Удалить индекс по source_kind.
-- ────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_tenders_source_kind;

-- ────────────────────────────────────────────────────────────────────
-- 5. Удалить саму колонку.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE tenders DROP COLUMN IF EXISTS source_kind;
