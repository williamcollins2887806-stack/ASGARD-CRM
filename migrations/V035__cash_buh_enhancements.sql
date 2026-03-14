-- V033: Добавление БУХ в цепочку кассы, баланс кассы, дедлайн получения
-- Новый flow: requested → approved → money_issued → received → reporting → closed

-- Новые колонки в cash_requests
ALTER TABLE cash_requests ADD COLUMN IF NOT EXISTS issued_by INTEGER REFERENCES users(id);
ALTER TABLE cash_requests ADD COLUMN IF NOT EXISTS issued_at TIMESTAMP;
ALTER TABLE cash_requests ADD COLUMN IF NOT EXISTS receipt_deadline TIMESTAMP;
ALTER TABLE cash_requests ADD COLUMN IF NOT EXISTS overdue_notified BOOLEAN DEFAULT false;

-- Баланс кассы (лог операций)
CREATE TABLE IF NOT EXISTS cash_balance_log (
  id SERIAL PRIMARY KEY,
  amount NUMERIC(15,2) NOT NULL,
  change_amount NUMERIC(15,2),
  change_type VARCHAR(50),
  description TEXT,
  related_request_id INTEGER REFERENCES cash_requests(id),
  user_id INTEGER REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_balance_log_created ON cash_balance_log(created_at DESC);

-- BUH получает write на cash_admin
UPDATE role_presets SET can_write = true WHERE role = 'BUH' AND module_key = 'cash_admin';
