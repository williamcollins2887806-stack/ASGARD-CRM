-- V034: Create cash_requests + related tables, add missing equipment columns
-- ================================================================

-- ═══════════════════════════════════════════════════════════════
-- 1. CASH MODULE — Missing tables
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cash_requests (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  work_id INTEGER REFERENCES works(id),
  type VARCHAR(20) NOT NULL DEFAULT 'advance',
  amount NUMERIC(12,2) NOT NULL,
  purpose TEXT NOT NULL,
  cover_letter TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'requested',
  director_id INTEGER REFERENCES users(id),
  director_comment TEXT,
  received_at TIMESTAMP,
  closed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_expenses (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES cash_requests(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  description TEXT NOT NULL,
  receipt_file VARCHAR(255),
  receipt_original_name VARCHAR(255),
  expense_date DATE DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_returns (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES cash_requests(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL,
  note TEXT,
  confirmed_by INTEGER REFERENCES users(id),
  confirmed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cash_messages (
  id SERIAL PRIMARY KEY,
  request_id INTEGER NOT NULL REFERENCES cash_requests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cash_requests_user ON cash_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_cash_requests_status ON cash_requests(status);
CREATE INDEX IF NOT EXISTS idx_cash_requests_work ON cash_requests(work_id);
CREATE INDEX IF NOT EXISTS idx_cash_expenses_request ON cash_expenses(request_id);
CREATE INDEX IF NOT EXISTS idx_cash_returns_request ON cash_returns(request_id);
CREATE INDEX IF NOT EXISTS idx_cash_messages_request ON cash_messages(request_id);

-- ═══════════════════════════════════════════════════════════════
-- 2. EQUIPMENT — Add missing columns
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE equipment ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS barcode VARCHAR(100);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS qr_code TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS qr_uuid UUID;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS unit VARCHAR(20) DEFAULT 'шт';
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS condition VARCHAR(50) DEFAULT 'good';
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS warranty_end DATE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS next_maintenance DATE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS next_calibration DATE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS maintenance_interval_days INTEGER;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS useful_life_months INTEGER DEFAULT 60;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS salvage_value NUMERIC(15,2) DEFAULT 0;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS auto_write_off BOOLEAN DEFAULT true;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS book_value NUMERIC(15,2);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS balance_status VARCHAR(30) DEFAULT 'on_balance';
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS balance_date DATE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS brand VARCHAR(200);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS model VARCHAR(200);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS specifications JSONB;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS written_off_date DATE;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS written_off_reason TEXT;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS written_off_by INTEGER REFERENCES users(id);
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS accumulated_depreciation NUMERIC(15,2) DEFAULT 0;
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id);

-- equipment_categories: add missing columns
ALTER TABLE equipment_categories ADD COLUMN IF NOT EXISTS code VARCHAR(20);
ALTER TABLE equipment_categories ADD COLUMN IF NOT EXISTS is_consumable BOOLEAN DEFAULT false;
ALTER TABLE equipment_categories ADD COLUMN IF NOT EXISTS requires_calibration BOOLEAN DEFAULT false;

-- ═══════════════════════════════════════════════════════════════
-- 3. Helper functions for equipment
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION generate_inventory_number(cat_code TEXT)
RETURNS TEXT AS $$
DECLARE
  next_num INTEGER;
  result TEXT;
BEGIN
  SELECT COALESCE(MAX(
    CAST(NULLIF(regexp_replace(inventory_number, '^[A-Z]+-', ''), '') AS INTEGER)
  ), 0) + 1
  INTO next_num
  FROM equipment
  WHERE inventory_number LIKE cat_code || '-%';

  result := cat_code || '-' || LPAD(next_num::TEXT, 5, '0');
  RETURN result;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION recalculate_all_depreciation()
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER := 0;
BEGIN
  UPDATE equipment SET
    accumulated_depreciation = CASE
      WHEN useful_life_months IS NOT NULL AND useful_life_months > 0
           AND balance_date IS NOT NULL AND purchase_price IS NOT NULL
      THEN LEAST(
        (purchase_price - COALESCE(salvage_value, 0)) *
        EXTRACT(EPOCH FROM (CURRENT_DATE - balance_date)) / 86400 /
        (useful_life_months * 30.44) ,
        purchase_price - COALESCE(salvage_value, 0)
      )
      ELSE 0
    END,
    book_value = CASE
      WHEN useful_life_months IS NOT NULL AND useful_life_months > 0
           AND balance_date IS NOT NULL AND purchase_price IS NOT NULL
      THEN GREATEST(
        purchase_price - LEAST(
          (purchase_price - COALESCE(salvage_value, 0)) *
          EXTRACT(EPOCH FROM (CURRENT_DATE - balance_date)) / 86400 /
          (useful_life_months * 30.44),
          purchase_price - COALESCE(salvage_value, 0)
        ),
        COALESCE(salvage_value, 0)
      )
      ELSE COALESCE(purchase_price, 0)
    END
  WHERE balance_status = 'on_balance' AND status != 'written_off';

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auto_write_off_expired()
RETURNS INTEGER AS $$
DECLARE
  wo_count INTEGER := 0;
BEGIN
  UPDATE equipment SET
    status = 'written_off',
    balance_status = 'written_off',
    book_value = COALESCE(salvage_value, 0),
    written_off_date = CURRENT_DATE,
    written_off_reason = 'Автосписание: истёк срок полезного использования'
  WHERE auto_write_off = true
    AND balance_status = 'on_balance'
    AND status != 'written_off'
    AND useful_life_months IS NOT NULL
    AND balance_date IS NOT NULL
    AND (balance_date + (useful_life_months || ' months')::INTERVAL) <= CURRENT_DATE;

  GET DIAGNOSTICS wo_count = ROW_COUNT;
  RETURN wo_count;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_total_book_value()
RETURNS TABLE(
  total_purchase_price NUMERIC,
  total_book_value NUMERIC,
  total_depreciation NUMERIC,
  equipment_count BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(SUM(e.purchase_price), 0) as total_purchase_price,
    COALESCE(SUM(e.book_value), 0) as total_book_value,
    COALESCE(SUM(e.accumulated_depreciation), 0) as total_depreciation,
    COUNT(*) as equipment_count
  FROM equipment e
  WHERE e.balance_status = 'on_balance' AND e.status != 'written_off';
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════
-- 4. Add cash/cash_admin modules + presets
-- ═══════════════════════════════════════════════════════════════

INSERT INTO modules (module_key, name, sort_order) VALUES
  ('cash', 'Касса', 50),
  ('cash_admin', 'Касса (управление)', 51)
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO role_presets (role, module_key, can_read, can_write, can_delete) VALUES
  ('PM', 'cash', true, true, false),
  ('HEAD_PM', 'cash', true, true, false),
  ('DIRECTOR_GEN', 'cash', true, true, true),
  ('DIRECTOR_GEN', 'cash_admin', true, true, true),
  ('DIRECTOR_COMM', 'cash', true, true, true),
  ('DIRECTOR_COMM', 'cash_admin', true, true, true),
  ('DIRECTOR_DEV', 'cash', true, true, true),
  ('DIRECTOR_DEV', 'cash_admin', true, true, true),
  ('BUH', 'cash', true, false, false),
  ('BUH', 'cash_admin', true, false, false)
ON CONFLICT (role, module_key) DO NOTHING;
