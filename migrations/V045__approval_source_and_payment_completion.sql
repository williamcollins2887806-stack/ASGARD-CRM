ALTER TABLE estimate_approval_requests
  ADD COLUMN IF NOT EXISTS source_type VARCHAR(50),
  ADD COLUMN IF NOT EXISTS source_id INTEGER;

UPDATE estimate_approval_requests
SET source_type = COALESCE(NULLIF(source_type, ''), 'estimate'),
    source_id = COALESCE(source_id, estimate_id)
WHERE source_type IS NULL
   OR source_type = ''
   OR source_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_estimate_approval_requests_source
  ON estimate_approval_requests(source_type, source_id);

CREATE TABLE IF NOT EXISTS approval_payment_slips (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES estimate_approval_requests(id) ON DELETE CASCADE,
  source_type VARCHAR(50) NOT NULL,
  source_id INTEGER NOT NULL,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  comment TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_payment_slips_document_id
  ON approval_payment_slips(document_id);

CREATE INDEX IF NOT EXISTS idx_approval_payment_slips_request_id
  ON approval_payment_slips(request_id, id);

CREATE INDEX IF NOT EXISTS idx_approval_payment_slips_source
  ON approval_payment_slips(source_type, source_id, id);
