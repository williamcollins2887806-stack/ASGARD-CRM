-- Telephony Job Queue for async processing
CREATE TABLE IF NOT EXISTS telephony_jobs (
  id SERIAL PRIMARY KEY,
  job_type VARCHAR(50) NOT NULL,  -- 'transcribe', 'analyze', 'download_recording', 'escalate_missed'
  call_id INTEGER REFERENCES call_history(id),
  payload JSONB DEFAULT '{}'::jsonb,
  status VARCHAR(20) DEFAULT 'pending',  -- pending, processing, done, failed, retry
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  error TEXT,
  scheduled_at TIMESTAMPTZ DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telephony_jobs_status ON telephony_jobs(status) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_telephony_jobs_scheduled ON telephony_jobs(scheduled_at) WHERE status IN ('pending', 'retry');
CREATE INDEX IF NOT EXISTS idx_telephony_jobs_call_id ON telephony_jobs(call_id);

-- Missed call escalation tracking
CREATE TABLE IF NOT EXISTS telephony_escalations (
  id SERIAL PRIMARY KEY,
  call_id INTEGER REFERENCES call_history(id),
  user_id INTEGER REFERENCES users(id),
  deadline_at TIMESTAMPTZ NOT NULL,
  escalated BOOLEAN DEFAULT false,
  escalated_at TIMESTAMPTZ,
  acknowledged BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_telephony_escalations_pending ON telephony_escalations(deadline_at) WHERE escalated = false AND acknowledged = false;
