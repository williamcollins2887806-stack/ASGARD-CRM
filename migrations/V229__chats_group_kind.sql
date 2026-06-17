-- V229 — chats.group_kind для семантики групповых чатов из v2 UI
-- Источник: D-83 RETARGET в _DIFF-LEDGER.md.
-- GroupEditModal.jsx даёт выбор public/private/work/broadcast, но колонка `type`
-- уже занята канонической таксономией direct/group/mimir (161 строка на проде).
-- Чтобы не ломать существующие данные и не плодить CHECK-конфликты — отдельная
-- колонка group_kind с дефолтом 'public' и whitelisted-значениями.
-- Idempotent: ADD COLUMN IF NOT EXISTS + DO-блок для CHECK.

ALTER TABLE chats ADD COLUMN IF NOT EXISTS group_kind VARCHAR(20) DEFAULT 'public';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chats_group_kind_check'
      AND conrelid = 'chats'::regclass
  ) THEN
    ALTER TABLE chats
      ADD CONSTRAINT chats_group_kind_check
      CHECK (group_kind IN ('public','private','work','broadcast'));
  END IF;
END $$;

-- Backfill: все существующие групповые чаты считаем 'public'
UPDATE chats SET group_kind = 'public'
WHERE group_kind IS NULL AND is_group = true;
