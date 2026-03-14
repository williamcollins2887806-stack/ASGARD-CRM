-- ============================================================
-- V038: Модуль телефонии — ASGARD CRM
-- Расширение call_history, user_call_status + новые таблицы
-- ============================================================

-- 1. Расширяем call_history
ALTER TABLE call_history
  ADD COLUMN IF NOT EXISTS mango_entry_id VARCHAR(200),
  ADD COLUMN IF NOT EXISTS mango_call_id VARCHAR(200),
  ADD COLUMN IF NOT EXISTS from_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS to_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS duration_seconds INTEGER,
  ADD COLUMN IF NOT EXISTS call_type VARCHAR(20) DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS record_path TEXT,
  ADD COLUMN IF NOT EXISTS recording_id VARCHAR(200),
  ADD COLUMN IF NOT EXISTS transcript TEXT,
  ADD COLUMN IF NOT EXISTS transcript_status VARCHAR(20) DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS transcript_segments JSONB,
  ADD COLUMN IF NOT EXISTS ai_summary TEXT,
  ADD COLUMN IF NOT EXISTS ai_is_target BOOLEAN,
  ADD COLUMN IF NOT EXISTS ai_lead_data JSONB,
  ADD COLUMN IF NOT EXISTS ai_sentiment VARCHAR(20),
  ADD COLUMN IF NOT EXISTS lead_id INTEGER,
  ADD COLUMN IF NOT EXISTS client_inn VARCHAR(50),
  ADD COLUMN IF NOT EXISTS dadata_region VARCHAR(150),
  ADD COLUMN IF NOT EXISTS dadata_operator VARCHAR(150),
  ADD COLUMN IF NOT EXISTS dadata_city VARCHAR(150),
  ADD COLUMN IF NOT EXISTS missed_task_id INTEGER,
  ADD COLUMN IF NOT EXISTS missed_acknowledged BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS missed_callback_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS webhook_payload JSONB,
  ADD COLUMN IF NOT EXISTS line_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS disconnect_reason VARCHAR(100),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Индексы для call_history
CREATE INDEX IF NOT EXISTS idx_call_history_mango_entry ON call_history(mango_entry_id);
CREATE INDEX IF NOT EXISTS idx_call_history_mango_call ON call_history(mango_call_id);
CREATE INDEX IF NOT EXISTS idx_call_history_client_inn ON call_history(client_inn);
CREATE INDEX IF NOT EXISTS idx_call_history_user_id ON call_history(user_id);
CREATE INDEX IF NOT EXISTS idx_call_history_created_at ON call_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_call_history_call_type ON call_history(call_type);
CREATE INDEX IF NOT EXISTS idx_call_history_transcript_status ON call_history(transcript_status) WHERE transcript_status != 'none';
CREATE INDEX IF NOT EXISTS idx_call_history_from_number ON call_history(from_number);
CREATE INDEX IF NOT EXISTS idx_call_history_to_number ON call_history(to_number);
CREATE INDEX IF NOT EXISTS idx_call_history_missed ON call_history(call_type, missed_acknowledged) WHERE call_type = 'missed';

-- 2. Расширяем user_call_status
ALTER TABLE user_call_status
  ADD COLUMN IF NOT EXISTS mango_extension VARCHAR(20),
  ADD COLUMN IF NOT EXISTS fallback_user_id INTEGER,
  ADD COLUMN IF NOT EXISTS fallback_mobile VARCHAR(50),
  ADD COLUMN IF NOT EXISTS work_schedule JSONB DEFAULT '{mon:{start:09:00,end:18:00},tue:{start:09:00,end:18:00},wed:{start:09:00,end:18:00},thu:{start:09:00,end:18:00},fri:{start:09:00,end:18:00}}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_duty BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(200),
  ADD COLUMN IF NOT EXISTS sip_login VARCHAR(100),
  ADD COLUMN IF NOT EXISTS last_call_at TIMESTAMPTZ;

-- 3. Правила маршрутизации
CREATE TABLE IF NOT EXISTS call_routing_rules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  priority INTEGER DEFAULT 0,
  condition_type VARCHAR(50) NOT NULL,
  condition_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  action_type VARCHAR(50) NOT NULL,
  action_value JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN DEFAULT true,
  created_by INTEGER REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_routing_rules_active ON call_routing_rules(is_active, priority DESC);

-- 4. Лог событий телефонии (для отладки и аудита)
CREATE TABLE IF NOT EXISTS telephony_events_log (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  mango_call_id VARCHAR(200),
  mango_entry_id VARCHAR(200),
  payload JSONB NOT NULL,
  processed BOOLEAN DEFAULT false,
  processing_result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tel_events_call_id ON telephony_events_log(mango_call_id);
CREATE INDEX IF NOT EXISTS idx_tel_events_created ON telephony_events_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tel_events_unprocessed ON telephony_events_log(processed) WHERE processed = false;

-- 5. Кэш аудиофайлов IVR (TTS)
CREATE TABLE IF NOT EXISTS ivr_audio_cache (
  id SERIAL PRIMARY KEY,
  text_hash VARCHAR(64) NOT NULL,
  text TEXT NOT NULL,
  file_path TEXT NOT NULL,
  voice VARCHAR(50) DEFAULT 'alena',
  format VARCHAR(20) DEFAULT 'oggopus',
  file_size INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ivr_cache_hash_voice ON ivr_audio_cache(text_hash, voice);

-- 6. Активные звонки (для popup и мониторинга в реальном времени)
CREATE TABLE IF NOT EXISTS active_calls (
  id SERIAL PRIMARY KEY,
  mango_call_id VARCHAR(200) NOT NULL UNIQUE,
  mango_entry_id VARCHAR(200),
  direction VARCHAR(20) NOT NULL,
  from_number VARCHAR(50),
  to_number VARCHAR(50),
  caller_name VARCHAR(200),
  caller_company VARCHAR(300),
  client_inn VARCHAR(50),
  assigned_user_id INTEGER REFERENCES users(id),
  call_state VARCHAR(30) DEFAULT 'ringing',
  started_at TIMESTAMPTZ DEFAULT NOW(),
  connected_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_active_calls_user ON active_calls(assigned_user_id);
CREATE INDEX IF NOT EXISTS idx_active_calls_state ON active_calls(call_state);

-- 7. Настройки телефонии (глобальные)
INSERT INTO settings (key, value) VALUES
  ('telephony_config', '{missed_deadline_minutes:30,ai_enabled:true,auto_transcribe:true,auto_analyze:true,ivr_enabled:false,record_storage:./uploads/call_records,default_greeting:Добрый день! Компания Асгард Сервис. Чем можем помочь?,after_hours_greeting:Спасибо за звонок. Сейчас нерабочее время. Оставьте сообщение после сигнала.,work_hours_start:09:00,work_hours_end:18:00}'::text)
ON CONFLICT (key) DO NOTHING;

-- 8. Добавляем модуль телефонии в permissions
INSERT INTO modules (code, name, description) VALUES
  ('telephony', 'Телефония', 'Журнал звонков, маршрутизация, статистика')
ON CONFLICT DO NOTHING;

