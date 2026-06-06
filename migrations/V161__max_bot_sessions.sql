-- V157: Состояние диалога MAX-бота закупок (личка с РП)
-- Бот ведёт пошаговый диалог: выбор работы → ввод позиций → создание заявки.
-- Связь телефона MAX с сотрудником — по employees.phone/phone2/wa_phone (уже есть).

CREATE TABLE IF NOT EXISTS max_bot_sessions (
  id           SERIAL       PRIMARY KEY,
  chat_id      VARCHAR(64)  NOT NULL UNIQUE,   -- '79991234567@c.us' (личка)
  phone_digits VARCHAR(20),                    -- нормализованный телефон
  user_id      INTEGER      REFERENCES users(id) ON DELETE SET NULL,    -- сотрудник CRM (РП)
  state        VARCHAR(30)  NOT NULL DEFAULT 'idle',  -- idle|awaiting_work|awaiting_items
  draft_json   JSONB        NOT NULL DEFAULT '{}',    -- {work_id, work_options:[...], procurement_id}
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_max_bot_sessions_phone ON max_bot_sessions(phone_digits) WHERE phone_digits IS NOT NULL;
