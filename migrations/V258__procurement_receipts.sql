-- V258: Распределённая приёмка позиций закупки (V173 follow-up).
--
-- До V258: PUT /:id/items/:itemId/deliver — all-or-nothing per item; принять 100 шт нельзя
-- разнести 50/30/20 на разные работы/склады без предварительного сплита по поставщикам.
--
-- После V258:
--   procurement_items.received_qty NUMERIC DEFAULT 0 — сколько суммарно уже принято.
--   procurement_items.cancelled_at / cancelled_reason — поля для item-cancel (см. 06-item-cancel.md).
--   procurement_receipts — таблица распределённых приёмок (одна позиция → N приёмок).
--
-- Старый /deliver остаётся как one-shot и не использует эту таблицу.
-- Источник правды по полям: tests/phase3-audit/03-v173-distributed-receive.md

-- ─────────────────────────────────────────────────────────────────────
-- 1. procurement_items — счётчик принятого + поля отмены
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE procurement_items
  ADD COLUMN IF NOT EXISTS received_qty NUMERIC DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_reason TEXT;

COMMENT ON COLUMN procurement_items.received_qty IS
  'Суммарно принято по procurement_receipts. При received_qty=quantity item_status=delivered, при 0<x<quantity → shipped (частичная).';
COMMENT ON COLUMN procurement_items.cancelled_at IS
  'Когда позиция была отменена через PUT /items/:itemId/cancel.';
COMMENT ON COLUMN procurement_items.cancelled_reason IS
  'Причина отмены (опционально), вводимая пользователем при cancel.';

-- ─────────────────────────────────────────────────────────────────────
-- 2. procurement_receipts — распределённые приёмки
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS procurement_receipts (
  id                    SERIAL PRIMARY KEY,
  procurement_item_id   INTEGER NOT NULL REFERENCES procurement_items(id) ON DELETE CASCADE,
  recipient_work_id     INTEGER REFERENCES works(id) ON DELETE SET NULL,
  quantity              NUMERIC NOT NULL CHECK (quantity > 0),
  location_id           INTEGER REFERENCES warehouse_locations(id) ON DELETE SET NULL,
  received_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  received_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  photo_url             TEXT,
  notes                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_proc_receipts_item ON procurement_receipts(procurement_item_id);
CREATE INDEX IF NOT EXISTS idx_proc_receipts_work ON procurement_receipts(recipient_work_id) WHERE recipient_work_id IS NOT NULL;

COMMENT ON TABLE procurement_receipts IS
  'Распределённые приёмки позиций закупки (V258). Одна позиция procurement_items → N строк (qty/работа/ячейка). Сумма quantity ≤ procurement_items.quantity.';
