-- ═══════════════════════════════════════════════════════════
-- ASGARD Field — Session 11: Master Funds + Packing Lists
-- ═══════════════════════════════════════════════════════════

-- 1. Подотчёт мастера — выдача средств
CREATE TABLE IF NOT EXISTS field_master_funds (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    master_employee_id INTEGER NOT NULL REFERENCES employees(id),
    issued_by INTEGER NOT NULL,

    amount DECIMAL(12,2) NOT NULL,
    purpose TEXT NOT NULL,

    confirmed_at TIMESTAMP,
    confirm_deadline TIMESTAMP,

    spent DECIMAL(12,2) DEFAULT 0,
    returned DECIMAL(12,2) DEFAULT 0,
    own_spent DECIMAL(12,2) DEFAULT 0,

    status VARCHAR(30) DEFAULT 'issued',
    -- 'issued' → 'confirmed' → 'reporting' → 'closed'

    closed_at TIMESTAMP,
    closed_by INTEGER,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_funds_work ON field_master_funds(work_id);
CREATE INDEX IF NOT EXISTS idx_field_funds_master ON field_master_funds(master_employee_id);

-- 2. Расходы мастера (чеки)
CREATE TABLE IF NOT EXISTS field_master_expenses (
    id SERIAL PRIMARY KEY,
    fund_id INTEGER REFERENCES field_master_funds(id),
    work_id INTEGER NOT NULL REFERENCES works(id),
    master_employee_id INTEGER NOT NULL REFERENCES employees(id),

    amount DECIMAL(12,2) NOT NULL,
    description TEXT NOT NULL,
    category VARCHAR(50),
    supplier VARCHAR(255),

    source VARCHAR(20) NOT NULL DEFAULT 'advance',
    -- 'advance' | 'own'

    receipt_filename VARCHAR(255),
    receipt_original VARCHAR(255),

    expense_date DATE DEFAULT CURRENT_DATE,

    work_expense_id INTEGER REFERENCES work_expenses(id),
    synced_at TIMESTAMP,

    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_expenses_fund ON field_master_expenses(fund_id);
CREATE INDEX IF NOT EXISTS idx_field_expenses_work ON field_master_expenses(work_id);

-- 3. Возвраты остатка
CREATE TABLE IF NOT EXISTS field_master_returns (
    id SERIAL PRIMARY KEY,
    fund_id INTEGER NOT NULL REFERENCES field_master_funds(id),
    amount DECIMAL(12,2) NOT NULL,
    note TEXT,
    confirmed_by INTEGER,
    confirmed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- 4. Листы сборки
CREATE TABLE IF NOT EXISTS field_packing_lists (
    id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL REFERENCES works(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,

    assigned_to INTEGER REFERENCES employees(id),
    assigned_by INTEGER,
    assigned_at TIMESTAMP,

    status VARCHAR(30) DEFAULT 'draft',
    -- 'draft' → 'sent' → 'in_progress' → 'completed' → 'shipped'

    items_total INTEGER DEFAULT 0,
    items_packed INTEGER DEFAULT 0,

    due_date DATE,
    shipped_at TIMESTAMP,
    tracking_number VARCHAR(100),

    created_by INTEGER,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_packing_work ON field_packing_lists(work_id);

-- 5. Позиции сборки
CREATE TABLE IF NOT EXISTS field_packing_items (
    id SERIAL PRIMARY KEY,
    list_id INTEGER NOT NULL REFERENCES field_packing_lists(id) ON DELETE CASCADE,

    item_name VARCHAR(255) NOT NULL,
    item_category VARCHAR(100),
    quantity_required INTEGER NOT NULL,
    quantity_packed INTEGER DEFAULT 0,
    unit VARCHAR(20) DEFAULT 'шт',

    equipment_id INTEGER,
    kit_id INTEGER,

    photo_filename VARCHAR(255),
    photo_original VARCHAR(255),
    photographed_at TIMESTAMP,
    photographed_by INTEGER REFERENCES employees(id),

    status VARCHAR(20) DEFAULT 'pending',
    -- 'pending' → 'packed' → 'shortage' → 'replaced'

    shortage_note TEXT,

    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_field_packing_items_list ON field_packing_items(list_id);
