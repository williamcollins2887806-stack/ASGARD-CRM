-- V447: D-390 — колонки «Работы завершены» и «Корзина» в личном Канбане.
--
-- ЗАПРОС (28.10.2026): «В канбан нужно добавить колонку работы завершены и
-- корзина куда мусор скинуть можно».
--
-- КАК СДЕЛАНО. Колонка в этом Канбане — не колонка таблицы, а ВЫЧИСЛЯЕМОЕ
-- значение функции pk_v3_column(flow_type, main_status). Поэтому новый этап
-- добавляется функцией, а не столбцом.
--
--   • «Завершено» (done)  — отдельный этап: карточка уходит из активных, но
--     остаётся в доске и не теряется. Отличается от win/work: те про деньги
--     и исполнение, а это «сделано, больше не в работе».
--   • «Корзина» (trash)   — мягкое удаление, как просили: карточка уходит из
--     активных колонок, но ВОССТАНОВИМА. Технически — is_closed=TRUE плюс
--     маркер в current_main_status='trash'. Так «корзина» не смешивается с
--     закрытыми по-настоящему (закрытая карта могла быть закрыта автоматически
--     из works и не должна выглядеть как мусор).
--
-- ВАЖНО: статусы done/trash добавлены для ВСЕХ flow_type, потому что terminate
-- и удаление доступны на любой карточке, независимо от типа.
--
-- Идемпотентна.

-- 1. Функция: добавить done и trash в маппинг.
CREATE OR REPLACE FUNCTION pk_v3_column(flow_type TEXT, main_status TEXT)
RETURNS TEXT IMMUTABLE LANGUAGE sql AS $$
SELECT CASE
  -- D-390: корзина и «Завершено» — общие для всех типов, поэтому СНАЧАЛА.
  WHEN main_status = 'trash'                                                                      THEN 'trash'
  WHEN main_status = 'done'                                                                       THEN 'done'
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
  WHEN flow_type='work' AND main_status='Закрыт'                                                   THEN 'done'
  WHEN flow_type='work'                                                                            THEN 'work'
  ELSE 'new'
END
$$;

COMMENT ON FUNCTION pk_v3_column(TEXT, TEXT) IS
  'D-390: колонка канбана по типу и статусу. trash/done общие для всех типов; work|Закрыт → done.';

-- 2. Индекс: в корзину и «Завершено» ходят редко, но фильтр по ним нужен.
--    Частичный индекс по is_closed=FALSE остаётся для активных колонок (V271),
--    а для корзины добавляем свой — иначе поиск «что в корзине» сканирует всё.
DROP INDEX IF EXISTS idx_pk_cards_v3_column;
CREATE INDEX idx_pk_cards_v3_column
  ON personal_kanban_cards (pk_v3_column(flow_type, current_main_status), owner_user_id)
  WHERE is_closed = FALSE;

CREATE INDEX IF NOT EXISTS idx_pk_cards_v3_trash
  ON personal_kanban_cards (owner_user_id, updated_at DESC)
  WHERE is_closed = TRUE AND current_main_status = 'trash';

-- 3. Ограничение: статусы done/trash допустимы для любого flow_type.
--    Прежние CHECK на статус были только у pre_tender_requests, у карточек
--    Канбана ограничения по значению статуса нет — проверка живёт в коде
--    (isValidMainStatus). Поэтому здесь ничего менять не нужно; но фиксируем
--    намерение комментарием в схеме.
COMMENT ON COLUMN personal_kanban_cards.current_main_status IS
  'Этап карточки. Служебные значения: trash (в корзине, восстановимо), done (завершено, не в работе). Остальные — по CANONICAL_MAIN_STATUSES своего flow_type.';
