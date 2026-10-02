-- V359: PBX core — Asterisk cutover (operators, call legs, call_history extensions, pbx_config)
-- Идемпотентно где возможно (IF NOT EXISTS).

-- 1. Операторы АТС (1:1 с users)
CREATE TABLE IF NOT EXISTS pbx_operators (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  can_accept BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 100,
  receive_mode TEXT NOT NULL DEFAULT 'browser' CHECK (receive_mode IN ('browser', 'mobile')),
  on_line BOOLEAN NOT NULL DEFAULT false,
  mobile_phone TEXT,
  sip_username TEXT UNIQUE,
  sip_password_hash TEXT,
  miss_streak INTEGER NOT NULL DEFAULT 0,
  paused_until TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ,
  webrtc_registered BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pbx_operators_on_line ON pbx_operators(on_line) WHERE on_line = true;
CREATE INDEX IF NOT EXISTS idx_pbx_operators_sort ON pbx_operators(sort_order, user_id);

-- 2. Ноги звонка (маршрутизация / переводы)
CREATE TABLE IF NOT EXISTS pbx_call_legs (
  id BIGSERIAL PRIMARY KEY,
  call_id TEXT NOT NULL,
  leg_seq INTEGER NOT NULL DEFAULT 1,
  user_id INTEGER REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('webrtc', 'mobile', 'external')),
  target_addr TEXT,
  role TEXT NOT NULL CHECK (role IN ('ring', 'answer', 'transfer_blind', 'transfer_consult', 'outbound', 'hold')),
  outcome TEXT CHECK (outcome IN ('answered', 'timeout', 'busy', 'rejected', 'no_dtmf', 'failed', 'cancelled', 'bridged')),
  ring_ms INTEGER,
  talk_ms INTEGER,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pbx_call_legs_call_id ON pbx_call_legs(call_id);
CREATE INDEX IF NOT EXISTS idx_pbx_call_legs_user_started ON pbx_call_legs(user_id, started_at DESC);

-- 3. Расширение call_history под PBX
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS pbx_uid TEXT;
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS answered_by INTEGER REFERENCES users(id);
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS wait_seconds INTEGER;
ALTER TABLE call_history ADD COLUMN IF NOT EXISTS outcome TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_history' AND column_name = 'recording_url'
  ) THEN
    ALTER TABLE call_history ADD COLUMN recording_url TEXT;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_call_history_pbx_uid
  ON call_history(pbx_uid) WHERE pbx_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_history_source ON call_history(source) WHERE source IS NOT NULL;

-- Совместимость: легаси-код пишет record_url — зеркало на recording_url (read-only для SQL)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'call_history' AND column_name = 'record_url'
  )
  AND NOT EXISTS (
    SELECT 1 FROM pg_views WHERE schemaname = 'public' AND viewname = 'call_history_record_url_compat'
  ) THEN
    EXECUTE $v$
      CREATE VIEW call_history_record_url_compat AS
      SELECT id,
             COALESCE(recording_url, record_url) AS effective_recording_url
      FROM call_history
    $v$;
  END IF;
END $$;

-- 4. Глобальные настройки PBX
INSERT INTO settings (key, value_json) VALUES (
  'pbx_config',
  '{
    "enabled": false,
    "routing_mode": "duty_first",
    "fallback_routing": "round_robin",
    "browser_ring_sec": 5,
    "mobile_ring_sec": 20,
    "total_wait_sec": 60,
    "miss_pause_after": 3,
    "miss_pause_minutes": 15,
    "parallel_ring": false,
    "confirm_dtmf": "1",
    "stt_min_seconds": 10,
    "outbound_line": "74993223062",
    "recording_base_path": "/var/lib/asgard-crm/recordings",
    "greeting_work_hours": "Добрый день! Компания Асgard Сервис. Чем можем помочь?",
    "greeting_after_hours": "Спасибо за звонок. Сейчас нерабочее время. Оставьте сообщение после сигнала.",
    "work_hours": {
      "mon": {"start": "09:00", "end": "18:00"},
      "tue": {"start": "09:00", "end": "18:00"},
      "wed": {"start": "09:00", "end": "18:00"},
      "thu": {"start": "09:00", "end": "18:00"},
      "fri": {"start": "09:00", "end": "18:00"},
      "sat": {"start": null, "end": null},
      "sun": {"start": null, "end": null}
    },
    "timezone": "Europe/Moscow"
  }'::jsonb
) ON CONFLICT (key) DO NOTHING;

-- 5. Функциональные индексы по последним 10 цифрам телефона (если колонки есть)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'phone'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS idx_customers_phone_last10
      ON customers (RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10))
      WHERE phone IS NOT NULL AND phone <> ''
    $idx$;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'phone'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS idx_employees_phone_last10
      ON employees (RIGHT(REGEXP_REPLACE(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10))
      WHERE phone IS NOT NULL AND phone <> ''
    $idx$;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'phone2'
  ) THEN
    EXECUTE $idx$
      CREATE INDEX IF NOT EXISTS idx_employees_phone2_last10
      ON employees (RIGHT(REGEXP_REPLACE(COALESCE(phone2, ''), '[^0-9]', '', 'g'), 10))
      WHERE phone2 IS NOT NULL AND phone2 <> ''
    $idx$;
  END IF;
END $$;
