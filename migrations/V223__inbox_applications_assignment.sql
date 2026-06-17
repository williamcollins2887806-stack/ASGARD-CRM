-- V223: расширение inbox_applications — назначение PM, детект пересланных писем,
-- маркер «требует ручной проверки», оригинальный отправитель из тела forwarded-email.
--
-- См. PERSONAL_KANBAN_AND_INBOX_PIPELINE.md §0.4 (что нет), §2.2 (assign-pm), §2.5 (forward-детект).
-- Существующий CHECK на status расширяется значением 'assigned' (UPDATE при назначении PM).

-- ─────────────────────────────────────────────────────────────────────
-- 1. Колонки назначения PM, forward-метаданные, маркер ручной проверки.
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE inbox_applications
  ADD COLUMN IF NOT EXISTS assigned_pm_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS assigned_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forwarded_by_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS forwarded_from_email  TEXT,
  ADD COLUMN IF NOT EXISTS source_kind           TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS needs_review          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS original_sender_email TEXT,
  ADD COLUMN IF NOT EXISTS original_sender_name  TEXT;

ALTER TABLE inbox_applications DROP CONSTRAINT IF EXISTS chk_inbox_applications_source_kind;
ALTER TABLE inbox_applications ADD CONSTRAINT chk_inbox_applications_source_kind
  CHECK (source_kind IN ('unknown','corporate_forward','external_direct','platform','manual'));

-- ─────────────────────────────────────────────────────────────────────
-- 2. Расширить CHECK на status — добавить 'assigned' (после assign-pm).
-- Существующий constraint называется inbox_applications_status_check (см. \d).
-- ─────────────────────────────────────────────────────────────────────
ALTER TABLE inbox_applications DROP CONSTRAINT IF EXISTS inbox_applications_status_check;
ALTER TABLE inbox_applications ADD CONSTRAINT inbox_applications_status_check
  CHECK (status::text = ANY (ARRAY[
    'new'::text,
    'ai_processed'::text,
    'under_review'::text,
    'assigned'::text,
    'accepted'::text,
    'rejected'::text,
    'archived'::text
  ]));

-- ─────────────────────────────────────────────────────────────────────
-- 3. Индексы под выборки «назначенные мне» и «нераспределённые».
-- ─────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_inbox_applications_assigned_pm
  ON inbox_applications(assigned_pm_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inbox_applications_unassigned
  ON inbox_applications(status, created_at DESC)
  WHERE assigned_pm_id IS NULL AND status IN ('new','ai_processed','under_review');

CREATE INDEX IF NOT EXISTS idx_inbox_applications_needs_review
  ON inbox_applications(needs_review, created_at DESC)
  WHERE needs_review = TRUE;

COMMENT ON COLUMN inbox_applications.assigned_pm_id IS
  'PM-владелец заявки. После назначения карта появляется на /personal-kanban PM с substage_id=NULL (если не настроены подэтапы).';
COMMENT ON COLUMN inbox_applications.source_kind IS
  'unknown / corporate_forward (сотрудник переслал) / external_direct (внешний отправитель) / platform / manual (прямая заявка PM или директора).';
COMMENT ON COLUMN inbox_applications.needs_review IS
  'true когда внешний sender или AI confidence низкий (<0.5) — нужна ручная проверка.';
COMMENT ON COLUMN inbox_applications.forwarded_from_email IS
  'email сотрудника, переславшего письмо (из From: forwarded-сообщения).';
COMMENT ON COLUMN inbox_applications.original_sender_email IS
  'email реального клиента, выдранный из тела forwarded-email (regex по "От:"/"From:").';
