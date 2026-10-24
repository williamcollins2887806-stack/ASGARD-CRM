-- V435: D-340 — выравнивание схемы equipment_requests с фактическим продом.
--
-- Проблема (найдена 22.10.2026 при проверке D-340).
-- Миграция V001 объявляет колонку `reject_reason`, но на проде её НЕТ: там
-- `rejection_reason` (в неё пишет код, src/routes/equipment.js:1488 и :1606).
-- Дополнительно на проде живут колонки, которых нет ни в одной миграции:
-- `reason`, `urgency`, `needed_from`, `needed_to`, `updated_at`.
--
-- Последствие: подъём БД «по миграциям с нуля» создаёт схему, отличную от прода.
-- Код падал бы с 42703 (undefined_column) на отклонении заявки оборудования.
--
-- Что делает миграция:
--   1) переименовывает `reject_reason` → `rejection_reason`, если первая есть
--      (на проде — no-op: колонки reject_reason нет);
--   2) добавляет недостающие колонки, если их нет.
-- Идемпотентна: можно запускать повторно.
--
-- ВАЖНО: не путать с одноимёнными `reject_reason` в других таблицах
-- (tenders, pre_tender_requests, payout_batch_items) — трогаем только
-- equipment_requests.

DO $$
BEGIN
  -- 1. reject_reason → rejection_reason (только если reject_reason существует
  --    и rejection_reason ещё нет — иначе на проде была бы ошибка).
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'equipment_requests' AND column_name = 'reject_reason'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'equipment_requests' AND column_name = 'rejection_reason'
  ) THEN
    ALTER TABLE equipment_requests RENAME COLUMN reject_reason TO rejection_reason;
    RAISE NOTICE 'V435: reject_reason переименована в rejection_reason';
  ELSE
    RAISE NOTICE 'V435: переименование не требуется (схема уже выровнена)';
  END IF;
END $$;

-- 2. Колонки, живущие на проде, но отсутствующие в миграциях.
ALTER TABLE equipment_requests ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE equipment_requests ADD COLUMN IF NOT EXISTS reason            TEXT;
ALTER TABLE equipment_requests ADD COLUMN IF NOT EXISTS urgency           VARCHAR(20);
ALTER TABLE equipment_requests ADD COLUMN IF NOT EXISTS needed_from       DATE;
ALTER TABLE equipment_requests ADD COLUMN IF NOT EXISTS needed_to         DATE;
ALTER TABLE equipment_requests ADD COLUMN IF NOT EXISTS updated_at        TIMESTAMP DEFAULT NOW();

-- Индекс по статусу: список заявок фильтруется по нему (список склада, отклонения).
CREATE INDEX IF NOT EXISTS idx_equipment_requests_status
  ON equipment_requests(status);
