-- ═══════════════════════════════════════════════════════════════════════════
-- Mimir Conductor Refactor — Сессия 1, Шаг 1.1
-- V138 (план: V136): сгенерированные письма заказчику + их ответы.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS mimir_customer_letters (
  id              BIGSERIAL PRIMARY KEY,
  conductor_run_id BIGINT NOT NULL REFERENCES mimir_conductor_runs(id) ON DELETE CASCADE,
  tender_id       BIGINT REFERENCES tenders(id),

  letter_number   TEXT NOT NULL,         -- 'АС-2026-05-30/Q001'
  direction       TEXT NOT NULL,         -- 'OUTGOING' / 'INCOMING'

  -- Содержимое
  subject_text    TEXT,
  body_text       TEXT NOT NULL,         -- markdown текст письма
  questions_ids   BIGINT[] NOT NULL DEFAULT '{}',     -- список ID из mimir_clarifications

  -- Файлы
  docx_path       TEXT,                  -- сгенерированный DOCX
  pdf_path        TEXT,                  -- сгенерированный PDF
  signed_pdf_path TEXT,                  -- если РП подписал и загрузил обратно
  uploaded_reply_path TEXT,              -- скан/файл ответа заказчика

  -- Получатель/отправитель
  to_organization TEXT,
  to_person       TEXT,
  to_email        TEXT,
  cc_emails       TEXT[],

  -- Состояние
  status          TEXT NOT NULL DEFAULT 'DRAFTED',
    -- DRAFTED, READY, SENT, REPLY_RECEIVED, PARSED, APPLIED, EXPIRED

  drafted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at         TIMESTAMPTZ,
  sent_by         BIGINT REFERENCES users(id),
  reply_received_at TIMESTAMPTZ,
  reply_applied_at TIMESTAMPTZ,

  -- Парсинг ответа
  reply_parsed_mapping JSONB,            -- { Q-001: { answer_text: "...", confidence: 0.95 } }

  reminders_sent_count INT DEFAULT 0,
  last_reminder_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcle_run        ON mimir_customer_letters(conductor_run_id);
CREATE INDEX IF NOT EXISTS idx_mcle_status     ON mimir_customer_letters(status);
CREATE INDEX IF NOT EXISTS idx_mcle_number     ON mimir_customer_letters(letter_number);
