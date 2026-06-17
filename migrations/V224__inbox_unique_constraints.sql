-- V224: UNIQUE индексы на emails.message_id и inbox_applications.email_id —
-- защита от гонок IMAP-процессора (см. src/services/imap.js:261-271 и :472-498).
--
-- На клоне asgard_crm_kanban_test проверено перед накаткой: дубликатов нет
-- (см. блок «pre-check» в MIGRATION_LOG_KANBAN.md). На случай дрейфа на проде
-- миграция включает идемпотентный DELETE «оставить max(id)» перед созданием UNIQUE.
--
-- Гонка, которую закрывает: имеющийся код в imap.js делает
--   SELECT id FROM emails WHERE message_id=$1 → если 0, INSERT.
-- Между SELECT и INSERT окно для дубля; UNIQUE + ON CONFLICT DO NOTHING закрывает.
-- На стороне inbox_applications.email_id такой же UNIQUE убирает дубль карты.

-- ─────────────────────────────────────────────────────────────────────
-- 1. Pre-normalize: пустые строки message_id → NULL.
-- IMAP-парсеры иногда пишут '' вместо настоящего Message-ID, и тогда
-- partial-индекс `WHERE message_id IS NOT NULL` ловит пустую строку как
-- значащую → UNIQUE падает на legacy-данных. Нормализуем сразу.
-- ─────────────────────────────────────────────────────────────────────
UPDATE emails SET message_id = NULL
  WHERE message_id IS NOT NULL AND btrim(message_id) = '';

-- ─────────────────────────────────────────────────────────────────────
-- 2. Defensive dedup (no-op если дубликатов нет).
-- ─────────────────────────────────────────────────────────────────────
DELETE FROM emails
WHERE message_id IS NOT NULL
  AND id NOT IN (
    SELECT max(id) FROM emails WHERE message_id IS NOT NULL GROUP BY message_id
  )
  AND id IN (
    SELECT id FROM emails e1
    WHERE e1.message_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM emails e2
        WHERE e2.message_id = e1.message_id AND e2.id <> e1.id
      )
  );

DELETE FROM inbox_applications
WHERE email_id IS NOT NULL
  AND id NOT IN (
    SELECT max(id) FROM inbox_applications WHERE email_id IS NOT NULL GROUP BY email_id
  )
  AND id IN (
    SELECT id FROM inbox_applications i1
    WHERE i1.email_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM inbox_applications i2
        WHERE i2.email_id = i1.email_id AND i2.id <> i1.id
      )
  );

-- ─────────────────────────────────────────────────────────────────────
-- 3. UNIQUE partial-indexes (только реально заполненные).
-- Доп. условие `<> ''` — на всякий случай (UPDATE выше уже привёл к NULL,
-- но индекс должен быть само-достаточен против будущих регрессий парсера).
-- ─────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS uq_emails_message_id
  ON emails(message_id)
  WHERE message_id IS NOT NULL AND message_id <> '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_inbox_applications_email_id
  ON inbox_applications(email_id)
  WHERE email_id IS NOT NULL;

COMMENT ON INDEX uq_emails_message_id IS
  'Дедуп IMAP: ON CONFLICT DO NOTHING при повторной обработке того же RFC822 Message-ID.';
COMMENT ON INDEX uq_inbox_applications_email_id IS
  'Дедуп карт inbox: один email → максимум одна заявка.';
