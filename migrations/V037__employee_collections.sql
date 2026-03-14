-- V037: Employee Collections (Подборки сотрудников для HR)
CREATE TABLE IF NOT EXISTS employee_collections (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    created_by INTEGER REFERENCES users(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_collection_items (
    id SERIAL PRIMARY KEY,
    collection_id INTEGER NOT NULL REFERENCES employee_collections(id) ON DELETE CASCADE,
    employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
    added_by INTEGER REFERENCES users(id),
    added_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(collection_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_ecol_items_coll ON employee_collection_items(collection_id);
CREATE INDEX IF NOT EXISTS idx_ecol_items_emp ON employee_collection_items(employee_id);
CREATE INDEX IF NOT EXISTS idx_ecol_active ON employee_collections(is_active) WHERE is_active = true;
