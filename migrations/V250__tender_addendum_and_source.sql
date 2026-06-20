-- V250: «Дозапрос» (addendum) в канбане ТО + поле tenders.source_kind.
--
-- Контекст (см. pipeline разведку INV-1):
--   * `tender_status` — VARCHAR(100) БЕЗ CHECK; новое значение 'Дозапрос'
--     вставится в DB без миграции на CHECK. Гейт переходов — в JS
--     (TENDER_TRANSITIONS, src/routes/tenders.js:9). DB-уровень открыт.
--   * `personal_kanban_cards.v3_column` НЕ существует как колонка — это
--     вычисляемое значение через IMMUTABLE-функцию pk_v3_column(flow_type,
--     main_status) (V238). 9-я канонная колонка 'addendum' добавляется
--     ОДНОЙ правкой тела функции.
--   * Функциональный индекс idx_pk_cards_v3_column хранит precomputed
--     значения функции. CREATE OR REPLACE FUNCTION НЕ инвалидирует индекс
--     автоматически — стейл-значения для уже существующих строк останутся
--     до REINDEX. Поэтому ниже DROP + CREATE того же индекса.
--   * tenders.source_kind — новое поле для бейджа источника. Значения:
--       manual         — введён руками (по умолчанию, для legacy-строк)
--       platform       — спарсен с ЭТП (zakupki/B2B/etc.) — пока заглушка
--       email_invite   — приглашение в тендер с почты, создано AI
--                        (минует pre_tender_requests)
--       email_request  — заявка с почты на оценку
--       phone          — из звонка (создаётся call-analyzer.createDraftLead)
--       pm_manual      — РП ввёл тендер
--       to_manual      — ТО ввёл тендер
--
-- Безопасно: только ADD COLUMN + CHECK + индексы + CREATE OR REPLACE FUNCTION.
-- Существующие записи получают source_kind='manual' через NOT NULL DEFAULT.
-- Никаких изменений данных, кроме backfill default.

-- ────────────────────────────────────────────────────────────────────
-- 1. tenders.source_kind — новое поле с идемпотентным CHECK.
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS source_kind VARCHAR(20) NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenders_source_kind_check'
  ) THEN
    ALTER TABLE tenders
      ADD CONSTRAINT tenders_source_kind_check
      CHECK (source_kind IN (
        'manual',
        'platform',
        'email_invite',
        'email_request',
        'phone',
        'pm_manual',
        'to_manual'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tenders_source_kind
  ON tenders(source_kind);

COMMENT ON COLUMN tenders.source_kind IS
  'Источник тендера для бейджа в списке хаба: manual (legacy/руками), '
  'platform (ЭТП-парсинг), email_invite (приглашение от заказчика, AI), '
  'email_request (заявка на оценку), phone (из звонка), pm_manual (РП ввёл), '
  'to_manual (ТО ввёл). См. V250 и pipeline/investigations/INV-1.md.';

-- ────────────────────────────────────────────────────────────────────
-- 2. pk_v3_column: добавлена 9-я канонная колонка 'addendum' для
--    статуса tender_status='Дозапрос'. Остальные ветки — без изменений
--    от V238 (точная копия + одна новая WHEN-строка).
-- ────────────────────────────────────────────────────────────────────
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
  WHEN flow_type='tender' AND main_status='Дозапрос'                                               THEN 'addendum'  -- V250: новая 9-я колонка
  WHEN flow_type='tender' AND main_status='Выиграли'                                               THEN 'win'
  WHEN flow_type='tender' AND main_status IN ('Проиграли','Не подходит')                           THEN 'lose'
  -- work
  WHEN flow_type='work'                                                                            THEN 'work'
  ELSE 'new'
END
$$;

-- ────────────────────────────────────────────────────────────────────
-- 3. Пересоздать функциональный индекс idx_pk_cards_v3_column.
--    PostgreSQL НЕ пересчитывает функциональные индексы при изменении
--    тела IMMUTABLE-функции. Без DROP/CREATE существующие карты с
--    main_status='Дозапрос' останутся в индексе как 'new' (старый
--    fallback), и запросы по WHERE pk_v3_column(...) = 'addendum' через
--    индекс не найдут их.
-- ────────────────────────────────────────────────────────────────────
DROP INDEX IF EXISTS idx_pk_cards_v3_column;
CREATE INDEX idx_pk_cards_v3_column
  ON personal_kanban_cards (pk_v3_column(flow_type, current_main_status), owner_user_id)
  WHERE is_closed = FALSE;

-- ────────────────────────────────────────────────────────────────────
-- 4. VIEW v_unified_kanban_cards пересоздавать НЕ требуется — она
--    ссылается на функцию по имени, новая логика применяется
--    автоматически при следующем плане запроса.
-- ────────────────────────────────────────────────────────────────────
