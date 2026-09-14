-- V353: адресное согласование просчёта тендера (до 4 получателей) + порог 10 млн без НДС
-- Достаточно согласия ЛЮБОГО одного из выбранных получателей.

CREATE TABLE IF NOT EXISTS tender_approval_recipients (
  id              SERIAL PRIMARY KEY,
  tender_id       INTEGER NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
  role_code       VARCHAR(20) NOT NULL,
  user_id         INTEGER REFERENCES users(id),
  label           VARCHAR(120) NOT NULL,
  email           VARCHAR(255),
  token_hash      CHAR(64) UNIQUE,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',
  decided_at      TIMESTAMPTZ,
  decided_comment TEXT,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tender_approval_recipients_status_check
    CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_tender_approval_recipients_tender
  ON tender_approval_recipients(tender_id);

CREATE INDEX IF NOT EXISTS idx_tender_approval_recipients_token
  ON tender_approval_recipients(token_hash);

COMMENT ON TABLE tender_approval_recipients IS
  'Адресное согласование просчёта: выбранные получатели (DIRECTOR_GEN / DIRECTOR_DEV / DIRECTOR_COMM / HEAD_TO) и их решения';

-- Порог согласования директора: 5 млн → 10 млн (без НДС)
UPDATE settings SET value_json = '10000000', updated_at = NOW()
WHERE key = 'director_tender_threshold_rub'
  AND value_json IN ('5000000', '"5000000"');

INSERT INTO settings (key, value_json, updated_at)
SELECT 'director_tender_threshold_rub', '10000000', NOW()
WHERE NOT EXISTS (SELECT 1 FROM settings WHERE key = 'director_tender_threshold_rub');
