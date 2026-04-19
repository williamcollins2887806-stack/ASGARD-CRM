-- V079: Таблица позиций расходов (товары/услуги из счетов)
-- Каждый work_expense может иметь N позиций с детализацией

CREATE TABLE IF NOT EXISTS work_expense_items (
  id SERIAL PRIMARY KEY,
  expense_id INTEGER NOT NULL REFERENCES work_expenses(id) ON DELETE CASCADE,
  position INTEGER DEFAULT 1,
  name TEXT NOT NULL,
  unit VARCHAR(20) DEFAULT 'шт',
  quantity NUMERIC(12,3) DEFAULT 1,
  price NUMERIC(14,2),
  amount NUMERIC(14,2),
  vat_rate NUMERIC(4,1),
  vat_amount NUMERIC(14,2),
  note TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_items_expense ON work_expense_items(expense_id);

COMMENT ON TABLE work_expense_items IS 'Позиции расходов — детализация товаров/услуг из счетов';
