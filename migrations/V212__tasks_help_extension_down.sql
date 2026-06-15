-- V212 DOWN: откат расширения «Помощь коллеги».
-- Безопасно: данные в help-задачах будут потеряны, но directive-поток не сломается
-- (старые поля остаются). Используется ТОЛЬКО на тест-клонах.

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_chat_id_fkey;
ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_task_kind_check;

DROP INDEX IF EXISTS idx_tasks_kind;
DROP INDEX IF EXISTS idx_tasks_chat;
DROP INDEX IF EXISTS idx_tasks_assignee_kind;
DROP INDEX IF EXISTS idx_tasks_creator_kind;

ALTER TABLE tasks
  DROP COLUMN IF EXISTS task_kind,
  DROP COLUMN IF EXISTS chat_id,
  DROP COLUMN IF EXISTS declined_reason,
  DROP COLUMN IF EXISTS declined_at,
  DROP COLUMN IF EXISTS declined_by,
  DROP COLUMN IF EXISTS redirected_from,
  DROP COLUMN IF EXISTS redirected_at,
  DROP COLUMN IF EXISTS redirected_once,
  DROP COLUMN IF EXISTS redirect_reason,
  DROP COLUMN IF EXISTS escalated_at,
  DROP COLUMN IF EXISTS escalated_to;
-- archived_at/archived_by НЕ откатываем — их использовал старый код (Phase 3).
