-- V221: личный канбан РП — подэтапы, карты, история перемещений.
--
-- Поддерживает фичу «Личный канбан с пользовательскими подэтапами» (см. PERSONAL_KANBAN_AND_INBOX_PIPELINE.md).
-- НЕ трогает существующие потоки статусов (tenders.tender_status, works.work_status,
-- pre_tender_requests.status, inbox_applications.status). Подэтапы — отдельный слой,
-- main_status хранится как TEXT-метка, чтобы не сломать tolerant matcher в src/helpers/work-status.js.
--
-- Источник правды по канонике main_status — runtime: TENDER_TRANSITIONS (src/routes/tenders.js),
-- WORK_STATUS_TRANSITIONS (src/routes/pm_works.js), CHECK для pre_tender в V046,
-- список значений inbox_applications.status. Бэкенд гарантирует, что main_status принимает
-- только значения из этих списков (ассерт в /api/personal-kanban).

-- ─────────────────────────────────────────────────────────────────────
-- 1. Подэтапы (пользовательские стадии внутри main_status одного PM)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS kanban_substages (
  id              SERIAL PRIMARY KEY,
  owner_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_type       TEXT    NOT NULL,
  main_status     TEXT    NOT NULL,
  title           TEXT    NOT NULL,
  sort_order      DOUBLE PRECISION NOT NULL DEFAULT 1000,
  color           TEXT    NOT NULL DEFAULT '#8a93a6',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE kanban_substages DROP CONSTRAINT IF EXISTS chk_kanban_substages_flow_type;
ALTER TABLE kanban_substages ADD CONSTRAINT chk_kanban_substages_flow_type
  CHECK (flow_type IN ('application','tender','pre_tender','work'));

ALTER TABLE kanban_substages DROP CONSTRAINT IF EXISTS chk_kanban_substages_title_len;
ALTER TABLE kanban_substages ADD CONSTRAINT chk_kanban_substages_title_len
  CHECK (char_length(btrim(title)) BETWEEN 2 AND 40);

ALTER TABLE kanban_substages DROP CONSTRAINT IF EXISTS chk_kanban_substages_color_fmt;
ALTER TABLE kanban_substages ADD CONSTRAINT chk_kanban_substages_color_fmt
  CHECK (color ~ '^#[0-9A-Fa-f]{3}([0-9A-Fa-f]{3})?$');

CREATE INDEX IF NOT EXISTS idx_kanban_substages_owner_flow_status
  ON kanban_substages(owner_user_id, flow_type, main_status, is_active, sort_order);

COMMENT ON TABLE kanban_substages IS
  'Пользовательские подэтапы PM внутри main_status одного flow_type. is_active=false — soft-delete (история ссылается).';
COMMENT ON COLUMN kanban_substages.sort_order IS
  'Дробное число для перестановок без перенумерации (вставка между i и i+1 = (i+i+1)/2).';
COMMENT ON COLUMN kanban_substages.version IS
  'Оптимистичная блокировка: PATCH требует совпадения, иначе 409.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Карты канбана (унифицирует inbox-заявку / тендер / pre-тендер / работу)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personal_kanban_cards (
  id                          SERIAL PRIMARY KEY,
  owner_user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  flow_type                   TEXT NOT NULL,
  entity_kind                 TEXT NOT NULL,
  entity_id                   INTEGER NOT NULL,
  current_main_status         TEXT NOT NULL,
  current_substage_id         INTEGER REFERENCES kanban_substages(id) ON DELETE SET NULL,
  transferred_from_user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  transferred_prev_substage_label TEXT,
  transferred_at              TIMESTAMPTZ,
  last_moved_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_closed                   BOOLEAN NOT NULL DEFAULT FALSE,
  version                     INTEGER NOT NULL DEFAULT 1,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE personal_kanban_cards DROP CONSTRAINT IF EXISTS chk_pk_cards_flow_type;
ALTER TABLE personal_kanban_cards ADD CONSTRAINT chk_pk_cards_flow_type
  CHECK (flow_type IN ('application','tender','pre_tender','work'));

ALTER TABLE personal_kanban_cards DROP CONSTRAINT IF EXISTS chk_pk_cards_entity_kind;
ALTER TABLE personal_kanban_cards ADD CONSTRAINT chk_pk_cards_entity_kind
  CHECK (entity_kind IN ('inbox_application','tender','pre_tender','work'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_pk_cards_owner_entity
  ON personal_kanban_cards(owner_user_id, entity_kind, entity_id);

CREATE INDEX IF NOT EXISTS idx_pk_cards_owner_status
  ON personal_kanban_cards(owner_user_id, current_main_status, is_closed, last_moved_at);

COMMENT ON TABLE personal_kanban_cards IS
  'Карта в личном канбане PM. Одна сущность (заявка/тендер/работа) → одна карта у текущего owner. При передаче owner_user_id меняется, исходный — в transferred_from_user_id.';
COMMENT ON COLUMN personal_kanban_cards.last_moved_at IS
  'Для индикатора зависания: если now()-last_moved_at>5d → жёлтая точка.';
COMMENT ON COLUMN personal_kanban_cards.version IS
  'Оптимистичная блокировка для /cards/:id/move.';

-- ─────────────────────────────────────────────────────────────────────
-- 3. Журнал перемещений (НЕИЗМЕНЯЕМЫЙ — append-only)
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS personal_kanban_card_history (
  id               BIGSERIAL PRIMARY KEY,
  card_id          INTEGER NOT NULL REFERENCES personal_kanban_cards(id) ON DELETE CASCADE,
  from_substage_id INTEGER REFERENCES kanban_substages(id) ON DELETE SET NULL,
  to_substage_id   INTEGER REFERENCES kanban_substages(id) ON DELETE SET NULL,
  from_main_status TEXT,
  to_main_status   TEXT NOT NULL,
  moved_by         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  moved_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  note             TEXT,
  action           TEXT NOT NULL DEFAULT 'move'
);

-- Журнал append-only: оригинальный план §1 V220 указывал NOT NULL moved_by,
-- но это рушит сценарий «уволили РП → история его перемещений не должна исчезать».
-- ON DELETE SET NULL: строки остаются с moved_by=NULL — кто двигал неизвестен,
-- но факт перемещения сохранён (action, to_main_status, note, moved_at).

ALTER TABLE personal_kanban_card_history DROP CONSTRAINT IF EXISTS chk_pk_history_action;
ALTER TABLE personal_kanban_card_history ADD CONSTRAINT chk_pk_history_action
  CHECK (action IN ('move','create','transfer','reopen','close','convert'));

CREATE INDEX IF NOT EXISTS idx_pk_history_card
  ON personal_kanban_card_history(card_id, moved_at DESC);

COMMENT ON TABLE personal_kanban_card_history IS
  'Append-only журнал перемещений карт. action=create — создание, move — обычное, transfer — смена owner, convert — смена entity_kind (inbox→tender→work).';
