-- ═══════════════════════════════════════════════════════════════
-- V240: employees.se_payee_id + is_se_payee
-- НАЗНАЧЕНИЕ:
-- Иногда рабочий получает оплату через РОДСТВЕННИКА (жена/брат/отец как СЗ).
-- Реквизиты НПД идут на родственника, лимиты НПД у родственника.
--   se_payee_id — указывает на employees.id получателя (родственника-СЗ).
--   is_se_payee  — этот employee сам не работает (нет смен в табеле),
--                  он только получает выплаты за кого-то.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE employees ADD COLUMN IF NOT EXISTS se_payee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS is_se_payee BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_employees_se_payee  ON employees(se_payee_id) WHERE se_payee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_employees_is_payee  ON employees(is_se_payee) WHERE is_se_payee = true;

COMMENT ON COLUMN employees.se_payee_id IS 'ID родственника-получателя НПД-выплат (если выплаты СЗ идут не на самого рабочего)';
COMMENT ON COLUMN employees.is_se_payee IS 'Этот employee — только получатель выплат (не рабочий, нет смен в табеле)';
