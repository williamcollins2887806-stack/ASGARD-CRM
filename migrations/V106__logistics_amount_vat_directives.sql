-- V106: field_logistics — добавить сумму, НДС, субтип, связь с расходами
-- Также добавить типы направлений МО и обучения

ALTER TABLE field_logistics
  ADD COLUMN IF NOT EXISTS amount          NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS vat_included    BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS item_subtype    VARCHAR(50),
  ADD COLUMN IF NOT EXISTS expense_linked  BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS expense_id      INTEGER REFERENCES work_expenses(id) ON DELETE SET NULL;

-- work_expenses — добавить НДС поля если их нет
ALTER TABLE work_expenses
  ADD COLUMN IF NOT EXISTS amount_vat      NUMERIC(15,2),
  ADD COLUMN IF NOT EXISTS expense_type    VARCHAR(50);

-- tenders — сумма согласованного просчёта
ALTER TABLE tenders
  ADD COLUMN IF NOT EXISTS estimate_value  NUMERIC(15,2);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_field_logistics_type ON field_logistics(item_type);
CREATE INDEX IF NOT EXISTS idx_field_logistics_created ON field_logistics(created_at DESC);
