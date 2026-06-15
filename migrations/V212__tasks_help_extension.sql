-- V212: «Помощь коллеги» — расширение задач, чтобы любой сотрудник мог
-- попросить любого. Старый поток директив (DIRECTOR_ROLES) сохраняется,
-- новый kind='help' открыт всем. Каждая задача = чат в Хугинне.
-- См. также:
--   src/routes/tasks.js          — POST/decline/redirect/reassign/escalate/help-inbox/outbox
--   src/services/taskChat.js     — createTaskChat / archiveTaskChat / postSystemMessage
--   public/desktop-v2-src/src/pages/Help/ — React v2 страница
--   public/assets/js/help_tasks.js        — vanilla страница
--   public/mobile-app/src/pages/HelpTasks.jsx — мобилка
-- Безопасно: только ADD COLUMN IF NOT EXISTS + индексы. Старые записи получают
-- task_kind='directive' по DEFAULT, поведение прежнего модуля не ломается.

-- 1. Колонки расширения
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS task_kind        VARCHAR(20) DEFAULT 'directive',
  ADD COLUMN IF NOT EXISTS chat_id          INTEGER,
  ADD COLUMN IF NOT EXISTS declined_reason  TEXT,
  ADD COLUMN IF NOT EXISTS declined_at      TIMESTAMP,
  ADD COLUMN IF NOT EXISTS declined_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS redirected_from  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS redirected_at    TIMESTAMP,
  ADD COLUMN IF NOT EXISTS redirected_once  BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS redirect_reason  TEXT,
  ADD COLUMN IF NOT EXISTS escalated_at     TIMESTAMP,
  ADD COLUMN IF NOT EXISTS escalated_to     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  -- эти две могут уже существовать (Phase 3 архивации) — на всякий случай:
  ADD COLUMN IF NOT EXISTS archived_at      TIMESTAMP,
  ADD COLUMN IF NOT EXISTS archived_by      INTEGER REFERENCES users(id) ON DELETE SET NULL;

-- 2. FK на chats (отложенно, чтобы не сломаться если chats нет на каком-то клоне)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='chats') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'tasks_chat_id_fkey'
    ) THEN
      ALTER TABLE tasks
        ADD CONSTRAINT tasks_chat_id_fkey
        FOREIGN KEY (chat_id) REFERENCES chats(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

-- 3. CHECK task_kind
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tasks_task_kind_check'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_task_kind_check
      CHECK (task_kind IN ('directive','help'));
  END IF;
END $$;

-- 4. Индексы
CREATE INDEX IF NOT EXISTS idx_tasks_kind        ON tasks(task_kind);
CREATE INDEX IF NOT EXISTS idx_tasks_chat        ON tasks(chat_id) WHERE chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_kind ON tasks(assignee_id, task_kind, status);
CREATE INDEX IF NOT EXISTS idx_tasks_creator_kind  ON tasks(creator_id,  task_kind, status);

-- 5. COMMENTS
COMMENT ON COLUMN tasks.task_kind IS
  'Тип: directive = задача от руководства (DIRECTOR_ROLES создают), help = помощь коллеги (любой → любому)';
COMMENT ON COLUMN tasks.chat_id IS
  'Связанный чат Хугинна (entity_type=task). Создаётся автоматически для help-задач, по желанию для directive.';
COMMENT ON COLUMN tasks.declined_reason IS
  'Причина отказа исполнителя. Заполняется при status=declined.';
COMMENT ON COLUMN tasks.redirected_from IS
  'Если задача перенаправлена — id исходного исполнителя. redirect возможен только 1 раз (redirected_once=true блокирует повтор).';
COMMENT ON COLUMN tasks.escalated_to IS
  'Если создатель эскалировал отказанную задачу — id руководителя отдела (HEAD_*).';
