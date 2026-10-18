-- V406: отложенное согласие по почте (проверка заказчика 18.10.2026).
--
-- Сценарий: директор (согласующий) отвечает «Добро» РАНЬШЕ, чем intake успел
-- создать заявку (письмо со счётом ещё разбирается — OCR занимает ~5 с).
-- Прежнее поведение: тред не найден → `needs_manual` («требует ручной привязки»),
-- и согласие ТЕРЯЛОСЬ: заявка появлялась позже и висела несогласованной,
-- хотя директор уже сказал «Добро».
--
-- Решение: сохраняем пришедшее согласие и применяем его, когда заявка появится
-- (привязка по треду/References). Сохраняем МИНИМУМ: какое письмо, кто, когда.
-- Сам разбор «Добро» остаётся в approval-detector (fail-closed) — здесь только
-- факт решения и его последующее применение.

CREATE TABLE IF NOT EXISTS doc_approval_grant (
  id            SERIAL PRIMARY KEY,
  email_id      INTEGER,                 -- письмо-ответ согласующего (для аудита)
  thread_key    VARCHAR(255),            -- корень треда (references/in-reply-to)
  message_id    VARCHAR(255),            -- Message-ID письма-ответа
  sender_email  VARCHAR(255) NOT NULL,   -- кто согласовал (проверен по списку)
  action        VARCHAR(12) NOT NULL DEFAULT 'approve',  -- approve | reject
  comment       TEXT,
  applied_at    TIMESTAMPTZ,             -- когда применено к заявке (NULL = ждёт)
  applied_ids   INTEGER[] DEFAULT '{}',  -- к каким заявкам применено
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ждём применения: выборка «неприменённые согласия по треду».
CREATE INDEX IF NOT EXISTS idx_doc_approval_grant_pending
  ON doc_approval_grant (thread_key) WHERE applied_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_doc_approval_grant_message
  ON doc_approval_grant (message_id);

-- Антидубль: одно письмо = одно согласие (повторная обработка того же письма).
CREATE UNIQUE INDEX IF NOT EXISTS uq_doc_approval_grant_message
  ON doc_approval_grant (message_id) WHERE message_id IS NOT NULL;
