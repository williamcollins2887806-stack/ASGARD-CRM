-- V155: Шаблоны заявок на закупку + повтор для постоянных работ.
-- Отдельные таблицы (не флаг is_template) — чище аналитика.

CREATE TABLE IF NOT EXISTS procurement_templates (
  id              SERIAL       PRIMARY KEY,
  name            VARCHAR(500) NOT NULL,
  description     TEXT,
  default_work_id INTEGER      REFERENCES works(id) ON DELETE SET NULL,
  usage_count     INTEGER      NOT NULL DEFAULT 0,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_by      INTEGER      NOT NULL REFERENCES users(id),
  updated_by      INTEGER      REFERENCES users(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS procurement_template_items (
  id                  SERIAL       PRIMARY KEY,
  template_id         INTEGER      NOT NULL REFERENCES procurement_templates(id) ON DELETE CASCADE,
  name                VARCHAR(500) NOT NULL,
  article             VARCHAR(255),
  unit                VARCHAR(50),
  default_quantity    NUMERIC(15,3),
  product_id          INTEGER      REFERENCES products(id)           ON DELETE SET NULL,
  product_category_id INTEGER      REFERENCES product_categories(id) ON DELETE SET NULL,
  typical_supplier_id INTEGER      REFERENCES suppliers(id)          ON DELETE SET NULL,
  typical_supplier    VARCHAR(500),
  notes               TEXT,
  sort_order          INTEGER      NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_proc_templates_active   ON procurement_templates(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_proc_templates_work     ON procurement_templates(default_work_id) WHERE default_work_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proc_tmpl_items_template ON procurement_template_items(template_id);
