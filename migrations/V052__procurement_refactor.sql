BEGIN;

-- ── 1. Переименовать tmc_requests → procurement_requests ──
ALTER TABLE tmc_requests RENAME TO procurement_requests;

DO $$ BEGIN ALTER SEQUENCE tmc_requests_id_seq RENAME TO procurement_requests_id_seq;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER INDEX IF EXISTS idx_tmc_requests_status RENAME TO idx_procurement_requests_status;
ALTER INDEX IF EXISTS idx_tmc_requests_work RENAME TO idx_procurement_requests_work;
ALTER INDEX IF EXISTS idx_tmc_requests_priority RENAME TO idx_procurement_requests_priority;
ALTER INDEX IF EXISTS idx_tmc_requests_payment RENAME TO idx_procurement_requests_payment;
ALTER INDEX IF EXISTS tmc_requests_pkey RENAME TO procurement_requests_pkey;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tmc_requests_author_id_fkey') THEN
  ALTER TABLE procurement_requests RENAME CONSTRAINT tmc_requests_author_id_fkey TO procurement_requests_author_id_fkey;
END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tmc_requests_approved_by_fkey') THEN
  ALTER TABLE procurement_requests RENAME CONSTRAINT tmc_requests_approved_by_fkey TO procurement_requests_approved_by_fkey;
END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tmc_requests_tender_id_fkey') THEN
  ALTER TABLE procurement_requests RENAME CONSTRAINT tmc_requests_tender_id_fkey TO procurement_requests_tender_id_fkey;
END IF; END $$;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname='tmc_requests_work_id_fkey') THEN
  ALTER TABLE procurement_requests RENAME CONSTRAINT tmc_requests_work_id_fkey TO procurement_requests_work_id_fkey;
END IF; END $$;

-- ── 2. Новые колонки ──
ALTER TABLE procurement_requests
  ADD COLUMN IF NOT EXISTS pm_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS proc_id INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS delivery_deadline DATE,
  ADD COLUMN IF NOT EXISTS deadline_type VARCHAR(20) DEFAULT 'fixed',
  ADD COLUMN IF NOT EXISTS deadline_days INTEGER,
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS pm_approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS dir_approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS dir_approved_by INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS locked BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS proc_comment TEXT,
  ADD COLUMN IF NOT EXISTS pm_comment TEXT;

UPDATE procurement_requests SET pm_id = author_id WHERE pm_id IS NULL AND author_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_procurement_requests_pm ON procurement_requests(pm_id);
CREATE INDEX IF NOT EXISTS idx_procurement_requests_proc ON procurement_requests(proc_id);

-- ── 3. Позиции ──
CREATE TABLE IF NOT EXISTS procurement_items (
  id SERIAL PRIMARY KEY,
  procurement_id INTEGER NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
  sort_order INTEGER DEFAULT 0,
  name VARCHAR(500) NOT NULL,
  article VARCHAR(200),
  unit VARCHAR(50) DEFAULT 'шт',
  quantity NUMERIC(12,3) NOT NULL DEFAULT 0,
  supplier VARCHAR(500),
  supplier_link TEXT,
  unit_price NUMERIC(14,2),
  total_price NUMERIC(14,2),
  invoice_doc_id INTEGER REFERENCES documents(id),
  delivery_target VARCHAR(20) DEFAULT 'warehouse' CHECK (delivery_target IN ('warehouse','object')),
  delivery_address VARCHAR(500),
  warehouse_id INTEGER REFERENCES warehouses(id),
  estimated_delivery DATE,
  actual_delivery DATE,
  item_status VARCHAR(30) DEFAULT 'pending' CHECK (item_status IN ('pending','ordered','shipped','delivered','cancelled')),
  equipment_id INTEGER REFERENCES equipment(id),
  received_by INTEGER REFERENCES users(id),
  received_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_procurement_items_req ON procurement_items(procurement_id);
CREATE INDEX idx_procurement_items_status ON procurement_items(item_status);

-- ── 4. Платёжки ──
CREATE TABLE IF NOT EXISTS procurement_payments (
  id SERIAL PRIMARY KEY,
  procurement_id INTEGER NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
  document_id INTEGER NOT NULL REFERENCES documents(id),
  amount NUMERIC(14,2),
  payment_date DATE,
  payment_number VARCHAR(100),
  bank_name VARCHAR(255),
  comment TEXT,
  uploaded_by INTEGER NOT NULL REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_procurement_payments_req ON procurement_payments(procurement_id);

-- ── 5. История ──
CREATE TABLE IF NOT EXISTS procurement_history (
  id SERIAL PRIMARY KEY,
  procurement_id INTEGER NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action VARCHAR(50) NOT NULL,
  old_status VARCHAR(30),
  new_status VARCHAR(30),
  comment TEXT,
  changes_json JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_procurement_history_req ON procurement_history(procurement_id);

-- ── 6. Удалить purchase_requests ──
DROP TABLE IF EXISTS purchase_requests CASCADE;

-- ── 7. VIEW совместимости (ТОЛЬКО ЧТЕНИЕ — INSERT/UPDATE невозможен) ──
-- Убедись, что все INSERT/UPDATE идут через /api/procurement, а не через tmc_requests
CREATE OR REPLACE VIEW tmc_requests AS SELECT * FROM procurement_requests;

COMMIT;
