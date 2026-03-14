CREATE TABLE IF NOT EXISTS estimate_approval_requests (
  id SERIAL PRIMARY KEY,
  estimate_id INTEGER NOT NULL UNIQUE REFERENCES estimates(id) ON DELETE CASCADE,
  tender_id INTEGER REFERENCES tenders(id) ON DELETE SET NULL,
  requested_by INTEGER NOT NULL REFERENCES users(id),
  pm_id INTEGER REFERENCES users(id),
  estimate_version_no INTEGER,
  current_stage VARCHAR(50) NOT NULL,
  last_rework_kind VARCHAR(20),
  submitted_snapshot_json JSONB NOT NULL,
  submitted_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_action_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_actor_id INTEGER REFERENCES users(id),
  last_comment TEXT,
  finalized_at TIMESTAMP,
  cancelled_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_estimate_approval_requests_tender_id
  ON estimate_approval_requests(tender_id);

CREATE INDEX IF NOT EXISTS idx_estimate_approval_requests_pm_id
  ON estimate_approval_requests(pm_id);

CREATE INDEX IF NOT EXISTS idx_estimate_approval_requests_stage
  ON estimate_approval_requests(current_stage);

CREATE TABLE IF NOT EXISTS estimate_approval_events (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES estimate_approval_requests(id) ON DELETE CASCADE,
  estimate_id INTEGER NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  action VARCHAR(50) NOT NULL,
  from_stage VARCHAR(50),
  to_stage VARCHAR(50) NOT NULL,
  actor_id INTEGER REFERENCES users(id),
  actor_role VARCHAR(50),
  comment TEXT,
  payload_json JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_estimate_approval_events_request_id
  ON estimate_approval_events(request_id, id);

CREATE INDEX IF NOT EXISTS idx_estimate_approval_events_estimate_id
  ON estimate_approval_events(estimate_id, id);
